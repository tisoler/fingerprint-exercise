# fingerprint-exercise
Exercise resolution for Fingerprint interview. This app get the transaction speeds by countries amd the transactions.
Finally it gets the prioritized subset of transactions to complete in a period of time, maximizing the amount of many.

### Running
Run `yarn` to install dependencies.

Run `yarn build` to generate the javascript files from typescript code.

Run `yarn start` to use the application.

Optional

By default the period of time considered as limit to run the transactions is 1000 ms.
However you can set the period of time as argument in the comman, e.g.: `yarn start 90`

### Env variables
The application needs 2 files, one for transaction speeds and other for transactions.
The file paths are defined in `constants.js`, you can export them in your env or set them in the .env file, if not, they will take default values:
`process.env.API_LATENCIES || 'dataSources/api_latencies.json'`
`process.env.TRANSACTIONS || 'dataSources/transactions.csv'`

### Question: What is the max USD value that can be processed in 50ms, 60ms, 90ms, 1000ms?
50ms: 3637.98
60ms: 4362.01
90ms: 6870.48
1000ms: 35471.81
