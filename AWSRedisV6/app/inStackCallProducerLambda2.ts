import { AWSError, Lambda } from 'aws-sdk'

export class LambdaClient {
    awsLambda: Lambda
    constructor(region: string) {
        this.awsLambda = new Lambda({ region })
    }

    trigger({ functionName, payload }): Promise<any> {
        return new Promise(
            (resolve, reject) => {
                const params = {
                    FunctionName: functionName,
                    InvocationType: 'RequestResponse',
                    LogType: 'Tail',
                    Payload: JSON.stringify(payload)
                };
                this.awsLambda.invoke(params, (err: AWSError, data: Lambda.InvocationResponse) => {
                    if (err) {
                        return reject(err)
                    }
                    if (data.StatusCode !== 200 && data.StatusCode !== 201) {
                        return reject(data)
                    }
                    const responsePayload = data.Payload
                    return resolve(JSON.parse(responsePayload.toString()))
                })

            }
        )
    }
}
