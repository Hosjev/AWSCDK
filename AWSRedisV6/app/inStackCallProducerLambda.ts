import * as AWS from 'aws-sdk'


const g_LambdaFunctionName = 'PRODUCER_LAMBDA'
const lambda = new AWS.Lambda

const invokeLambda = async (lambdaFunctionName, payload) => {
   console.log('>>> Entering invokeLambda')

   let payloadStr
   if (typeof payload === 'string')
   {
       console.log('invokeLambda:  payload parameter is already a string: ', payload)
       payloadStr = payload
   }
   else
   {
       payloadStr = JSON.stringify(payload, null, 2)
       console.log('invokeLambda: converting payload parameter to a string: ', payloadStr)
   }

   let params = {
       FunctionName   : lambdaFunctionName,               /* string type, required */
       InvocationType : 'RequestResponse',                /* string type: 'Event' (async)| 'RequestResponse' (sync) | 'DryRun' (validate parameters y permissions) */
       LogType        : 'None',                           /* string type: 'None' | 'Tail' */
       Payload        : payloadStr,                       /* Buffer.from('...') || 'JSON_STRING' */ /* Strings will be Base-64 encoded on your behalf */
   }

   const lambdaResult = await lambda.invoke(params).promise()

   return lambdaResult
}


export const callWrappedLambda = async (event) => {

   const lambdaFunctionName = g_LambdaFunctionName
   const result = await invokeLambda(lambdaFunctionName, event)

   // return result
}
