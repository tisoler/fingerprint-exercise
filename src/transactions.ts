require('dotenv').config()
import { API_LATENCIES, TRANSACTIONS } from "./constants"
import * as fs from 'fs'

interface TransactionSpeed {
  country: string,
  speed: number,
}

interface Transaction {
  id: string,
  amount: number,
  rate: number,
  speed: number,
}

interface TransactionsByCountry { [country: string]: { speed: number, transactions: Transaction[] }}

const getTransactionSpeedsArray = (): TransactionSpeed[] => {
  if (!fs.existsSync(`./${API_LATENCIES}`)) {
    throw new Error('There is not API_LATENCIES file.')
  }
  const transactionSpeedRates = require(`../${API_LATENCIES}`)
  const transactionSpeedKeys = Object.keys(transactionSpeedRates)
  if (!transactionSpeedRates || !transactionSpeedKeys.length) {
    throw new Error('There are not transaction data in the API_LATENCIES file.')
  }

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

  return transactionSpeeds
}

const getTransactionsArray = (transactionSpeeds: TransactionSpeed[]): TransactionsByCountry => {
  if (!fs.existsSync(`./${TRANSACTIONS}`)) {
    throw new Error('There is not TRANSACTIONS file.')
  }
  const data = fs.readFileSync(`./${TRANSACTIONS}`, "utf8")
  const rows = data.split("\n")

  // Create a sorted dictionary (by speed) with all the transactions by country (from the transactionSpeeds array)
  const transactionsByCountry: TransactionsByCountry = Object.assign({}, ...transactionSpeeds.map((t) => ({[t.country]: { speed: t.speed, transactions: [] }})));
  // Skip header
  for (let i = 1; i < rows.length; i++) {
    const rowArray = rows[i].split(",")
    if (rowArray.length < 3 || !rowArray[2]) {
      throw new Error(`No country for transaction ${rowArray[0] ?? ''}`)
    }
    const country = rowArray[2]

    if (isNaN(rowArray[1] as any)) {
      throw new Error(`No valid amount for transaction ${rowArray[0] ?? ''}`)
    }
    
    const currentTransactionsByCountry = transactionsByCountry[country]
    if (!currentTransactionsByCountry) {
      throw new Error(`No country data for ${country} - Transaction ${rowArray[0] ?? ''}`)
    } else {
      const transaction: Transaction = {
        id: rowArray[0],
        amount: parseFloat(rowArray[1]),
        rate: (parseFloat(rowArray[1]) / currentTransactionsByCountry.speed),
        speed: currentTransactionsByCountry.speed
      }
      
      // Add sorted element
      let added = false
      const countryTransactions = currentTransactionsByCountry.transactions
      for (let j = 0; j < countryTransactions.length; j ++) {
        if (countryTransactions[j].amount < transaction.amount) {
          countryTransactions.splice(j, 0, transaction)
          added = true
          break
        }
      }
      // If it is the last one, then insert it
      if (!added) currentTransactionsByCountry.transactions.push(transaction)
    }
  }
  return transactionsByCountry
}

// function should return a subset (or full array)
// that will maximize the USD value and fit the transactions under 1 second
function prioritize(transactionsByCountry: TransactionsByCountry, totalTime: number = 1000): Transaction[] {
  const transactionsByCountryArray = Object.values(transactionsByCountry)
  const prioritizedTransactions: Transaction[] = []
  let remainingTime = totalTime
  let currentIndex: number
  
  const setNewIndex = () => {
    currentIndex = -1
    for (let i = transactionsByCountryArray.length - 1; i >= 0; i--) {
      if (transactionsByCountryArray[i].speed <= remainingTime) {
        currentIndex = i
        break
      }
    }
  }
  // Initialize index
  setNewIndex()

  while (remainingTime > 0 && currentIndex >= 0) {
    let selectedCountryTransactionIndex: number
    let bestRate: number = -1

    // Get next best transactiomn
    for (let i = currentIndex; i >= 0; i--) {
      const countryTransactions = transactionsByCountryArray[i].transactions
      const bestRateForCountry = countryTransactions[0].rate
      if (bestRate < bestRateForCountry) {
        selectedCountryTransactionIndex = i
        bestRate = bestRateForCountry
      }
    }

    const selectedCountryTransations = transactionsByCountryArray[selectedCountryTransactionIndex]
    // Add the current best transaction to the resut and remove it from the list by country to avoid selecting it again
    const bestTransaction = selectedCountryTransations.transactions.shift()
    prioritizedTransactions.push(bestTransaction)
    // Update remainingTime
    remainingTime -= selectedCountryTransations.speed
    // Set new index
    setNewIndex()
  }

  return prioritizedTransactions
}

const main = () => {
  try {
    // Get totalTime from params
    const args = process.argv.slice(2);
    const totalTime = args[0] && !isNaN(args[0] as any) ? parseInt(args[0]) : undefined

    const transactionSpeeds = getTransactionSpeedsArray()
    const transactions = getTransactionsArray(transactionSpeeds)
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