require('dotenv').config()
import { API_LATENCIES, LIMIT_TIME_EXHAUSTIVE_SEARCH, TRANSACTIONS } from "./constants"
import * as fs from 'fs'
import { cloneDeep } from 'lodash'

interface TransactionSpeed {
  country: string,
  speed: number,
}

interface TransactionSpeedDict {
  [country: string]: number
}

interface Transaction {
  ID: string,
  Amount: number,
  BankCountryCode: string,
  Rate: number,
  Speed: number,
}

interface TransactionsBySpeed { [speed: number]: Transaction[] }

const getTransactionSpeedsDict = (): TransactionSpeedDict => {
  if (!fs.existsSync(`./${API_LATENCIES}`)) {
    throw new Error('There is not API_LATENCIES file.')
  }
  const transactionSpeedRates = require(`../${API_LATENCIES}`)
  const transactionSpeedKeys = Object.keys(transactionSpeedRates)
  if (!transactionSpeedRates || !transactionSpeedKeys.length) {
    throw new Error('There are not transaction data in the API_LATENCIES file.')
  }

  // Build a sorted array of country speeds
  const transactionSpeeds: TransactionSpeed[] = transactionSpeedKeys.map(country => ({ country, speed: transactionSpeedRates[country]}))

  // Create a sorted dictionary by country to facilitate the search
  const transactionSpeedsByCountry: TransactionSpeedDict = Object.assign({}, ...transactionSpeeds.map((t) => ({[t.country]: t.speed})))
  return transactionSpeedsByCountry
}

const getTransactionsDict = (transactionSpeedsByCountry: TransactionSpeedDict): TransactionsBySpeed => {
  if (!fs.existsSync(`./${TRANSACTIONS}`)) {
    throw new Error('There is not TRANSACTIONS file.')
  }
  const data = fs.readFileSync(`./${TRANSACTIONS}`, "utf8")
  const rows = data.split("\n")

  // Create a sorted dictionary with all the transactions grouped by speed (based on the transactionSpeedsByCountry array)
  const uniqueSpeeds = Object.values(transactionSpeedsByCountry)
  const transactionsBySpeed: TransactionsBySpeed = Object.assign({}, ...[...new Set(uniqueSpeeds)]?.map(speed => ({ [speed]: [] })))

  // Skip header - column names
  for (let i = 1; i < rows.length; i++) {
    const rowArray = rows[i].split(",")
    if (rowArray.length < 3 || !rowArray[2]) {
      throw new Error(`No country for transaction ${rowArray[0] ?? ''}`)
    }
    const transactionCountry = rowArray[2]

    if (isNaN(rowArray[1] as any)) {
      throw new Error(`No valid amount for transaction ${rowArray[0] ?? ''}`)
    }
    
    const transactionSpeed = transactionSpeedsByCountry[transactionCountry]
    if (!transactionSpeed) {
      throw new Error(`No country data for ${transactionCountry} - Transaction ${rowArray[0] ?? ''}`)
    } else {
      const transaction: Transaction = {
        ID: rowArray[0],
        Amount: parseFloat(rowArray[1]),
        BankCountryCode: transactionCountry,
        Rate: parseFloat(rowArray[1]) / transactionSpeed,
        Speed: transactionSpeed,
      }

      // Add sorted element
      let added = false
      const speedTransactions = transactionsBySpeed[transactionSpeed]
      for (let j = 0; j < speedTransactions.length; j ++) {
        if (speedTransactions[j].Amount < transaction.Amount) {
          speedTransactions.splice(j, 0, transaction)
          added = true
          break
        }
      }
      // If it is the last one, then insert it
      if (!added) speedTransactions.push(transaction)
    }
  }
  return transactionsBySpeed
}

// function should return a subset (or full array)
// that will maximize the USD value and fit the transactions under 1 second
function prioritize(transactionsBySpeed: TransactionsBySpeed, totalTime: number = 1000): Transaction[] {
  // Create a sorted array to facilitate the order and decrease the number of iterations
  const transactionsBySpeedArray: { speed: number, transactions: Transaction[] }[] = Object.entries(transactionsBySpeed)
    ?.map(([speed, transactions]) => ({speed: parseInt(speed), transactions}))

  let remainingTime = totalTime
  let currentIndex = transactionsBySpeedArray.length - 1

  const updateIndex = () => {
    for (let i = transactionsBySpeedArray.length - 1; i >= 0; i--) {
      const node = transactionsBySpeedArray[i]
      if (node.speed <= remainingTime && node.transactions.length) {
        currentIndex = i
        return
      }
    }
    currentIndex = -1
  }

  // Initialize currentIndex
  updateIndex()

  let currentBranch: Transaction[] = []
  let bestBranch: Transaction[] = []
  let bestAmount = 0
  let indexLastExcludedTransaction = -1
  let excludedTransactionRules: { [position: number]: number[] } = {}
  while (currentIndex >= 0) {
    let bestTransaction: Transaction = { ID: null, Rate: 0, Amount: null, BankCountryCode: null, Speed: null }

    // Get next best transactiomn
    for (let i = currentIndex; i >= 0; i--) {
      const speedNodeTransactions = transactionsBySpeedArray[i].transactions
      if (!speedNodeTransactions.length) continue
      const currentBranchIds = currentBranch?.map(cbt => cbt.ID) || []
      const newBestTransaction = speedNodeTransactions.find(
        snt => !excludedTransactionRules[currentBranch.length]?.includes(snt.Speed)
        && !currentBranchIds.includes(snt.ID)
      )
      if (!newBestTransaction) continue
      if (bestTransaction.Rate < newBestTransaction.Rate) {
        bestTransaction = newBestTransaction
      }
    }

    if (bestTransaction.ID) {
      // Add the current best transaction to the resut
      currentBranch.push(bestTransaction)
      // Update remainingTime
      remainingTime -= bestTransaction.Speed
      // Update currentIndex
      updateIndex()
    }

    // No more transactions, finalize the process
    if (!currentBranch.length) break

    // If there are not more items, it evaluates the current branch
    // Also it excludes speeds for some branch positions
    if (currentIndex < 0 || !bestTransaction.ID) {
      const currentAmount = currentBranch.reduce((total, node) => total + node.Amount, 0)
      if (currentAmount > bestAmount) {
        bestBranch = cloneDeep(currentBranch)
        bestAmount = currentAmount
      }
      if (remainingTime > 0 || totalTime <= LIMIT_TIME_EXHAUSTIVE_SEARCH) {
        indexLastExcludedTransaction = bestTransaction.ID ? currentBranch.length - 1 : indexLastExcludedTransaction -= 1
        // Add exclude rule
        const excludedSpeedForPosition = currentBranch[currentBranch.length - 1].Speed
        if (excludedTransactionRules[indexLastExcludedTransaction]) excludedTransactionRules[indexLastExcludedTransaction].push(excludedSpeedForPosition)
        else excludedTransactionRules[indexLastExcludedTransaction] = [excludedSpeedForPosition]
        // Clean rules for lower position in the dict
        Object.keys(excludedTransactionRules).forEach((position) => {
          if (parseInt(position) > indexLastExcludedTransaction) delete excludedTransactionRules[position]
        })
        // Update current branch
        const transactionsToReInsert = currentBranch.slice(indexLastExcludedTransaction, currentBranch.length)
        currentBranch.splice(indexLastExcludedTransaction, currentBranch.length - indexLastExcludedTransaction)
        // Update remaining time
        remainingTime += transactionsToReInsert.reduce((time, transaction) => time + transaction.Speed, 0)
        // Update the currentIndex again to continue searching
        updateIndex()
        // Move indexLastExcludedTransaction to next higher position
        if (currentIndex < 0) indexLastExcludedTransaction -= 1
      }
    }
  }
  return bestBranch
}

const main = () => {
  try {
    // Get totalTime from arguments
    const args = process.argv.slice(2);
    const totalTime = args[0] && !isNaN(args[0] as any) ? parseInt(args[0]) : undefined

    const transactionSpeeds = getTransactionSpeedsDict()
    const transactions = getTransactionsDict(transactionSpeeds)
    const result = prioritize(transactions, totalTime)

    const totalAmount = result.reduce((ac: number, transaction: Transaction) => ac + transaction.Amount, 0)
    console.log({
      transactions: result,
      transactionsQuantity: result.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      totalSpeed: result.reduce((ac: number, transaction: Transaction) => ac + transaction.Speed, 0),
    })
  } catch (e) {
    console.error(`ÈRROR: ${e.message || 'Internal server error'}.`)
  }
}

main()