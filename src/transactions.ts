require('dotenv').config()
import { API_LATENCIES, TRANSACTIONS } from "./constants"
import * as fs from 'fs'

interface TransactionSpeed {
  country: string,
  speed: number,
}

interface TransactionSpeedDict {
  [country: string]: number
}

interface Transaction {
  id: string,
  amount: number,
  rate: number,
  speed: number,
  country: string,
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
  const transactionSpeeds: TransactionSpeed[] = []
  transactionSpeedKeys.forEach(country => {
    let added = false
    const transactionSpeed = { country, speed: transactionSpeedRates[country]}
    // Add sorted element
    for (let i = 0; i < transactionSpeeds.length; i ++) {
      if (transactionSpeeds[i].speed > transactionSpeedRates[country]) {
        transactionSpeeds.splice(i, 0, transactionSpeed)
        added = true
        break
      }
    }
    // If it is the first element or the last one, then insert it
    if (!added) transactionSpeeds.push(transactionSpeed)
  })

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
        id: rowArray[0],
        amount: parseFloat(rowArray[1]),
        rate: parseFloat(rowArray[1]) / transactionSpeed,
        speed: transactionSpeed,
        country: transactionCountry,
      }
      
      // Add sorted element
      let added = false
      const speedTransactions = transactionsBySpeed[transactionSpeed]
      for (let j = 0; j < speedTransactions.length; j ++) {
        if (speedTransactions[j].amount < transaction.amount) {
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
  const transactionsBySpeedArray = Object.entries(transactionsBySpeed).map(([speed, transactions]) => ({speed: parseInt(speed), transactions}))
  const prioritizedTransactions: Transaction[] = []
  let remainingTime = totalTime
  let currentIndex = transactionsBySpeedArray.length - 1

  const updateIndex = () => {
    for (let i = currentIndex; i >= 0; i--) {
      if (transactionsBySpeedArray[i].speed <= remainingTime) {
        currentIndex = i
        return
      }
    }
    currentIndex = -1
  }
  // Initialize index
  updateIndex()

  while (remainingTime > 0 && currentIndex >= 0) {
    let selectedSpeedTransactionIndex = -1
    let bestRate: number = -1

    // Get next best transactiomn
    for (let i = currentIndex; i >= 0; i--) {
      const speedTransactions = transactionsBySpeedArray[i].transactions
      if (!speedTransactions.length) continue
      const bestRateForCountry = speedTransactions[0].rate
      if (bestRate < bestRateForCountry) {
        selectedSpeedTransactionIndex = i
        bestRate = bestRateForCountry
      }
    }

    // If there are nor more items it exits
    if (selectedSpeedTransactionIndex < 0) break

    const selectedCountryTransations = transactionsBySpeedArray[selectedSpeedTransactionIndex]
    // Add the current best transaction to the resut and remove it from the list by speed to avoid selecting it again
    const bestTransaction = selectedCountryTransations.transactions.shift()
    prioritizedTransactions.push(bestTransaction)
    // Update remainingTime
    remainingTime -= selectedCountryTransations.speed
    // Set new index
    updateIndex()
    // Reset local index
    selectedSpeedTransactionIndex = -1
  }

  return prioritizedTransactions
}

const main = () => {
  try {
    // Get totalTime from arguments
    const args = process.argv.slice(2);
    const totalTime = args[0] && !isNaN(args[0] as any) ? parseInt(args[0]) : undefined

    const transactionSpeeds = getTransactionSpeedsDict()
    const transactions = getTransactionsDict(transactionSpeeds)
    const result = prioritize(transactions, totalTime)
    console.log({
      transactions: result,
      transactionsQuantity: result.length,
      totalAmount: result.reduce((ac: number, transaction: Transaction) => ac + transaction.amount, 0),
      totalSpeed: result.reduce((ac: number, transaction: Transaction) => ac + transaction.speed, 0),
    })
  } catch (e) {
    console.error(`ÈRROR: ${e.message || 'Internal server error'}.`)
  }
}

main()