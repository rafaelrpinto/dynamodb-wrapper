import { DynamoDB } from 'aws-sdk';
import { DynamoDBWrapper } from './dynamodb-wrapper';

function testAsync(fn) {
    return (done) => {
        fn.apply(null, arguments)
            .then(() => done())
            .catch((err) => done.fail(err));
    };
}

class MockDynamoDB {
    public throttleRequests: number[];
    public unprocessedItemsRequests: number[];

    public tableData: any;
    private _countRequests: number;

    constructor(options?: any) {
        options = options || {};
        this.throttleRequests = options.throttleRequests || [];
        this.unprocessedItemsRequests = options.unprocessedItemsRequests || [];

        this.tableData = {};
        this._countRequests = 0;
    }

    public shouldThrottleThisResponse() {
        return this.throttleRequests.indexOf(this._countRequests) > -1;
    }

    public shouldHaveUnprocessedItemsOnThisResponse() {
        return this.unprocessedItemsRequests.indexOf(this._countRequests) > -1;
    }

    public getItem() {
        return this._mockApiResult();
    }

    public updateItem() {
        return this._mockApiResult();
    }

    public deleteItem() {
        return this._mockApiResult();
    }

    public putItem(params: DynamoDB.PutItemInput) {
        return {
            promise: () => {
                return new Promise((resolve, reject) => {
                    this._countRequests++;

                    if (this.shouldThrottleThisResponse()) {
                        reject({
                            code: 'ProvisionedThroughputExceededException',
                            statusCode: 400
                        });
                    } else {
                        // case: put item successful
                        const tableName = params.TableName;
                        this.tableData[tableName] = this.tableData[tableName] || [];
                        this.tableData[tableName].push(params.Item);
                        resolve({
                            ConsumedCapacity: { CapacityUnits: 1 }
                        });
                    }
                });
            }
        };
    }

    public query(params: DynamoDB.QueryInput) {
        return this._mockQueryOrScanResponse(params);
    }

    public scan(params: DynamoDB.ScanInput) {
        return this._mockQueryOrScanResponse(params);
    }

    public batchWriteItem(params: DynamoDB.BatchWriteItemInput) {
        return {
            promise: () => {
                return new Promise((resolve, reject) => {
                    this._countRequests++;

                    if (this.shouldThrottleThisResponse()) {
                        reject({
                            code: 'ProvisionedThroughputExceededException',
                            statusCode: 400
                        });
                    } else {
                        let tableNames = Object.keys(params.RequestItems);
                        let response = {};

                        if (this.shouldHaveUnprocessedItemsOnThisResponse()) {
                            response['UnprocessedItems'] = params.RequestItems;
                        } else {
                            // case: put item successful
                            for (let tableName of tableNames) {
                                this.tableData[tableName] = this.tableData[tableName] || [];
                                for (let writeRequest of params.RequestItems[tableName]) {
                                    this.tableData[tableName].push(writeRequest.PutRequest.Item);
                                }
                            }
                        }

                        if (params.ReturnConsumedCapacity === 'INDEXES') {
                            response['ConsumedCapacity'] = [
                                {
                                    CapacityUnits: 7,
                                    TableName: tableNames[0],
                                    Table: {
                                        CapacityUnits: 2
                                    },
                                    LocalSecondaryIndexes: {
                                        MyLocalIndex: {
                                            CapacityUnits: 4
                                        }
                                    },
                                    GlobalSecondaryIndexes: {
                                        MyGlobalIndex: {
                                            CapacityUnits: 1
                                        }
                                    }
                                }
                            ];
                        } else if (params.ReturnConsumedCapacity === 'TOTAL') {
                            response['ConsumedCapacity'] = [
                                {
                                    CapacityUnits: 7,
                                    TableName: tableNames[0]
                                }
                            ];
                        }

                        resolve(response);
                    }
                });
            }
        };
    }

    private _mockQueryOrScanResponse(params: any) {
        return {
            promise: () => {
                return new Promise(resolve => {
                    this._countRequests++;

                    // create mock response
                    let response = {
                        Items: []
                    };

                    // create mock items
                    for (let i = 0; i < params.Limit; i++) {
                        response.Items.push({});
                    }

                    if (params.ReturnConsumedCapacity === 'INDEXES') {
                        response['ConsumedCapacity'] = {
                            CapacityUnits: 7,
                            TableName: params.TableName,
                            Table: {
                                CapacityUnits: 2
                            },
                            LocalSecondaryIndexes: {
                                MyLocalIndex: {
                                    CapacityUnits: 4
                                }
                            },
                            GlobalSecondaryIndexes: {
                                MyGlobalIndex: {
                                    CapacityUnits: 1
                                }
                            }
                        };
                    } else if (params.ReturnConsumedCapacity === 'TOTAL') {
                        response['ConsumedCapacity'] = {
                            CapacityUnits: 7,
                            TableName: params.TableName
                        };
                    }

                    if (this._countRequests < 3) {
                        response['LastEvaluatedKey'] = 'foo';
                    }

                    resolve(response);
                });
            }
        };
    }

    private _mockApiResult() {
        return {
            promise: () => {
                return new Promise(resolve => {
                    resolve({});
                });
            }
        };
    }

}

describe('lib/dynamodb-wrapper', () => {

    function _setupDynamoDBWrapper(options?: any) {
        options = options || {};
        let mockDynamoDB = new MockDynamoDB(options);
        return {
            dynamoDB: mockDynamoDB,
            dynamoDBWrapper: new DynamoDBWrapper(mockDynamoDB, {
                batchWaitMs: 0,
                maxRetries: 2,
                retryDelayOptions: {
                    base: 0
                }
            })
        };
    }

    it('should initialize with default options', () => {
        let dynamoDB = new MockDynamoDB();
        let dynamoDBWrapper = new DynamoDBWrapper(dynamoDB);

        expect(dynamoDBWrapper.tableNamePrefix).toBe('');
        expect(dynamoDBWrapper.batchWaitMs).toBe(100);
        expect(dynamoDBWrapper.maxRetries).toBe(10);
        expect(dynamoDBWrapper.retryDelayOptions).toEqual({
            base: 100
        });
    });

    it('should initialize with custom options', () => {
        let dynamoDB = new MockDynamoDB();
        let dynamoDBWrapper = new DynamoDBWrapper(dynamoDB, {
            tableNamePrefix: 'local',
            batchWaitMs: 5,
            maxRetries: 3,
            retryDelayOptions: {
                base: 42,
                customBackoff: function (retryCount) { return 100 * retryCount; }
            }
        });

        expect(dynamoDBWrapper.tableNamePrefix).toBe('local');
        expect(dynamoDBWrapper.batchWaitMs).toBe(5);
        expect(dynamoDBWrapper.maxRetries).toBe(3);
        expect(dynamoDBWrapper.retryDelayOptions.base).toBe(42);
        expect(dynamoDBWrapper.retryDelayOptions.customBackoff).toBeDefined();
    });

    it('should initialize with custom options', () => {
        let dynamoDB = new MockDynamoDB();
        let dynamoDBWrapper = new DynamoDBWrapper(dynamoDB, {
            tableNamePrefix: 'local',
            batchWaitMs: 5,
            maxRetries: 3,
            retryDelayOptions: {
                base: 42,
                customBackoff: function (retryCount) { return 100 * retryCount; }
            }
        });

        expect(dynamoDBWrapper.tableNamePrefix).toBe('local');
        expect(dynamoDBWrapper.batchWaitMs).toBe(5);
        expect(dynamoDBWrapper.maxRetries).toBe(3);
        expect(dynamoDBWrapper.retryDelayOptions.base).toBe(42);
        expect(dynamoDBWrapper.retryDelayOptions.customBackoff).toBeDefined();
    });

    describe('getItem()', () => {

        it('should get item', testAsync(() => {
            async function test() {
                let params: any = {};
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'getItem').and.callThrough();
                await dynamoDBWrapper.getItem(params);

                expect(dynamoDB.getItem).toHaveBeenCalledWith(params);
            }

            return test();
        }));

    });

    describe('updateItem()', () => {

        it('should update item', testAsync(() => {
            async function test() {
                let params: any = {};
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'updateItem').and.callThrough();
                await dynamoDBWrapper.updateItem(params);

                expect(dynamoDB.updateItem).toHaveBeenCalledWith(params);
            }

            return test();
        }));

    });

    describe('deleteItem()', () => {

        it('should delete item', testAsync(() => {
            async function test() {
                let params: any = {};
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'deleteItem').and.callThrough();
                await dynamoDBWrapper.deleteItem(params);

                expect(dynamoDB.deleteItem).toHaveBeenCalledWith(params);
            }

            return test();
        }));

    });

    describe('putItem()', () => {

        function _setupPutItemParams(): DynamoDB.PutItemInput {
            return {
                TableName: 'Test',
                Item: {
                    MyPartitionKey: { N: '1' }
                }
            };
        }

        it('should put item', testAsync(() => {
            async function test() {
                let params = _setupPutItemParams();
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'putItem').and.callThrough();
                await dynamoDBWrapper.putItem(params);

                expect(dynamoDB.putItem).toHaveBeenCalledWith(params);
            }

            return test();
        }));

        it('should retry a failed request (throttled)', testAsync(() => {
            async function test() {
                let params = _setupPutItemParams();
                let mock = _setupDynamoDBWrapper({ throttleRequests: [1] });
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'putItem').and.callThrough();
                await dynamoDBWrapper.putItem(params);

                expect(dynamoDB.putItem).toHaveBeenCalledTimes(2);
            }

            return test();
        }));

        it('should throw a fatal exception when the maximum number of retries is exceeded', testAsync(() => {
            async function test() {
                let params = _setupPutItemParams();
                let mock = _setupDynamoDBWrapper({ throttleRequests: [1, 2, 3] });
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;
                dynamoDBWrapper.retryDelayOptions.customBackoff = function (retryCount) {
                    return 100 * retryCount;
                };

                spyOn(dynamoDB, 'putItem').and.callThrough();

                let exception;
                try {
                    await dynamoDBWrapper.putItem(params);
                } catch (e) {
                    exception = e;
                }

                expect(dynamoDB.putItem).toHaveBeenCalledTimes(3);
                expect(exception.code).toBe('ProvisionedThroughputExceededException');
                expect(exception.statusCode).toBe(400);
            }

            return test();
        }));
    });

    describe('query()', () => {

        function _setupQueryParams(returnConsumedCapacity?: string): DynamoDB.QueryInput {
            let params: any = {
                TableName: 'Test',
                KeyConditionExpression: 'MyPartitionKey = :pk',
                ExpressionAttributeValues: {
                    ':pk': {
                        N: '1'
                    }
                },
                Limit: 2
            };

            if (returnConsumedCapacity) {
                params['ReturnConsumedCapacity'] = returnConsumedCapacity;
            }

            return params;
        }

        it('should query by LastEvaluatedKey to return all pages of data', testAsync(() => {
            async function test() {
                let params = _setupQueryParams();
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'query').and.callThrough();
                let response = await dynamoDBWrapper.query(params);

                expect(dynamoDB.query).toHaveBeenCalledTimes(3);
                expect(response.Items.length).toBe(6);
                expect(response.ConsumedCapacity).not.toBeDefined();
            }

            return test();
        }));

        it('should aggregate consumed capacity (TOTAL) from multiple responses', testAsync(() => {
            async function test() {
                let params = _setupQueryParams('TOTAL');
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'query').and.callThrough();
                let response = await dynamoDBWrapper.query(params);

                expect(dynamoDB.query).toHaveBeenCalledTimes(3);
                expect(response.Items.length).toBe(6);
                expect(response.ConsumedCapacity).toEqual({
                    CapacityUnits: 21,
                    TableName: params.TableName
                });
            }

            return test();
        }));

        it('should aggregate consumed capacity (INDEXES) from multiple responses', testAsync(() => {
            async function test() {
                let params = _setupQueryParams('INDEXES');
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'query').and.callThrough();
                let response = await dynamoDBWrapper.query(params);

                expect(dynamoDB.query).toHaveBeenCalledTimes(3);
                expect(response.Items.length).toBe(6);
                expect(response.ConsumedCapacity).toEqual({
                    CapacityUnits: 21,
                    TableName: params.TableName,
                    Table: {
                        CapacityUnits: 6
                    },
                    LocalSecondaryIndexes: {
                        MyLocalIndex: {
                            CapacityUnits: 12
                        }
                    },
                    GlobalSecondaryIndexes: {
                        MyGlobalIndex: {
                            CapacityUnits: 3
                        }
                    }
                });
            }

            return test();
        }));

    });

    describe('scan()', () => {

        function _setupScanParams(returnConsumedCapacity?: string): DynamoDB.QueryInput {
            let params: any = {
                TableName: 'Test',
                KeyConditionExpression: 'MyPartitionKey = :pk',
                ExpressionAttributeValues: {
                    ':pk': {
                        N: '1'
                    }
                },
                Limit: 2
            };

            if (returnConsumedCapacity) {
                params['ReturnConsumedCapacity'] = returnConsumedCapacity;
            }

            return params;
        }

        it('should scan by LastEvaluatedKey to return all pages of data', testAsync(() => {
            async function test() {
                let params = _setupScanParams();
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'scan').and.callThrough();
                let response = await dynamoDBWrapper.scan(params);

                expect(dynamoDB.scan).toHaveBeenCalledTimes(3);
                expect(response.Items.length).toBe(6);
                expect(response.ConsumedCapacity).not.toBeDefined();
            }

            return test();
        }));

        it('should aggregate consumed capacity (TOTAL) from multiple responses', testAsync(() => {
            async function test() {
                let params = _setupScanParams('TOTAL');
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'scan').and.callThrough();
                let response = await dynamoDBWrapper.scan(params);

                expect(dynamoDB.scan).toHaveBeenCalledTimes(3);
                expect(response.Items.length).toBe(6);
                expect(response.ConsumedCapacity).toEqual({
                    CapacityUnits: 21,
                    TableName: params.TableName
                });
            }

            return test();
        }));

        it('should aggregate consumed capacity (INDEXES) from multiple responses', testAsync(() => {
            async function test() {
                let params = _setupScanParams('INDEXES');
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'scan').and.callThrough();
                let response = await dynamoDBWrapper.scan(params);

                expect(dynamoDB.scan).toHaveBeenCalledTimes(3);
                expect(response.Items.length).toBe(6);
                expect(response.ConsumedCapacity).toEqual({
                    CapacityUnits: 21,
                    TableName: params.TableName,
                    Table: {
                        CapacityUnits: 6
                    },
                    LocalSecondaryIndexes: {
                        MyLocalIndex: {
                            CapacityUnits: 12
                        }
                    },
                    GlobalSecondaryIndexes: {
                        MyGlobalIndex: {
                            CapacityUnits: 3
                        }
                    }
                });
            }

            return test();
        }));

    });

    describe('batchWriteItem()', () => {

        function _setupBatchWriteItemParams(returnConsumedCapacity?: string): DynamoDB.BatchWriteItemInput {
            let params: any = {
                RequestItems: {
                    Test: []
                }
            };

            for (let i = 0; i < 10; i++) {
                params.RequestItems['Test'].push({
                    PutRequest: {
                        Item: {
                            MyPartitionKey: { N: i.toString() }
                        }
                    }
                });
            }

            if (returnConsumedCapacity) {
                params['ReturnConsumedCapacity'] = returnConsumedCapacity;
            }

            return params;
        }

        it('should throw a NotYetImplemented exception for item collection metrics', testAsync(() => {
            async function test() {
                let mock = _setupDynamoDBWrapper();
                let dynamoDBWrapper = mock.dynamoDBWrapper;
                let params: any = {
                    ReturnItemCollectionMetrics: 'SIZE'
                };

                let exception;
                try {
                    await dynamoDBWrapper.batchWriteItem(params);
                } catch (e) {
                    exception = e;
                }

                expect(exception.code).toBe('NotYetImplementedError');
                expect(exception.message).toBe('ReturnItemCollectionMetrics is supported in the AWS DynamoDB API, ' +
                    'but this capability is not yet implemented by this wrapper library.');
            }

            return test();
        }));

        it('should throw a NotYetImplemented exception for multiple table names', testAsync(() => {
            async function test() {
                let mock = _setupDynamoDBWrapper();
                let dynamoDBWrapper = mock.dynamoDBWrapper;
                let params: any = {
                    RequestItems: {
                        Table1: [],
                        Table2: []
                    }
                };

                let exception;
                try {
                    await dynamoDBWrapper.batchWriteItem(params);
                } catch (e) {
                    exception = e;
                }

                expect(exception.code).toBe('NotYetImplementedError');
                expect(exception.message).toBe('Expected exactly 1 table name in RequestItems, but found 0 or 2+. ' +
                    'Writing to more than 1 table with BatchWriteItem is supported in the AWS DynamoDB API, ' +
                    'but this capability is not yet implemented by this wrapper library.');
            }

            return test();
        }));

        it('should throw a NotYetImplemented exception for DeleteRequests', testAsync(() => {
            async function test() {
                let mock = _setupDynamoDBWrapper();
                let dynamoDBWrapper = mock.dynamoDBWrapper;
                let params: any = {
                    RequestItems: {
                        Table1: [
                            {
                                DeleteRequest: {}
                            }
                        ]
                    }
                };

                let exception;
                try {
                    await dynamoDBWrapper.batchWriteItem(params);
                } catch (e) {
                    exception = e;
                }

                expect(exception.code).toBe('NotYetImplementedError');
                expect(exception.message).toBe('DeleteRequest in BatchWriteItem is supported in the AWS DynamoDB API, ' +
                    'but this capability is not yet implemented by this wrapper library.');
            }

            return test();
        }));

        it('should batch write items with default options', testAsync(() => {
            async function test() {
                let params = _setupBatchWriteItemParams();
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'batchWriteItem').and.callThrough();

                await dynamoDBWrapper.batchWriteItem(params);

                expect(dynamoDB.batchWriteItem).toHaveBeenCalledTimes(2);

            }

            return test();
        }));

        it('should batch write items with custom options', testAsync(() => {
            async function test() {
                let params = _setupBatchWriteItemParams();
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'batchWriteItem').and.callThrough();

                await dynamoDBWrapper.batchWriteItem(params, {
                    heuristic: 'ItemCount',
                    targetItemCount: 4
                });

                expect(dynamoDB.batchWriteItem).toHaveBeenCalledTimes(3);

            }

            return test();
        }));

        it('should batch write items with custom options', testAsync(() => {
            async function test() {
                let params = _setupBatchWriteItemParams();
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'batchWriteItem').and.callThrough();

                await dynamoDBWrapper.batchWriteItem(params, {
                    heuristic: 'ItemCount',
                    targetItemCount: 4
                });

                expect(dynamoDB.batchWriteItem).toHaveBeenCalledTimes(3);

            }

            return test();
        }));

        it('should retry failed requests (throttled)', testAsync(() => {
            async function test() {
                let params = _setupBatchWriteItemParams();
                let mock = _setupDynamoDBWrapper({ unprocessedItemsRequests: [1] });
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'batchWriteItem').and.callThrough();

                await dynamoDBWrapper.batchWriteItem(params, {
                    heuristic: 'ItemCount',
                    targetItemCount: 10
                });

                expect(dynamoDB.batchWriteItem).toHaveBeenCalledTimes(2);

            }

            return test();
        }));

        it('should throw a fatal exception when the maximum number of retries is exceeded', testAsync(() => {
            async function test() {
                let params = _setupBatchWriteItemParams();
                let mock = _setupDynamoDBWrapper({ unprocessedItemsRequests: [1, 2, 3] });
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                let exception;
                try {
                    await dynamoDBWrapper.batchWriteItem(params, {
                        heuristic: 'ItemCount',
                        targetItemCount: 10
                    });
                } catch (e) {
                    exception = e;
                }

                expect(exception.code).toBe('ProvisionedThroughputExceededException');
                expect(exception.message).toBe('The level of configured provisioned throughput for the table was exceeded. ' +
                    'Consider increasing your provisioning level with the UpdateTable API');
            }

            return test();
        }));

        it('should aggregate consumed capacity (TOTAL) from multiple responses', testAsync(() => {
            async function test() {
                let params = _setupBatchWriteItemParams('TOTAL');
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'batchWriteItem').and.callThrough();

                let response = await dynamoDBWrapper.batchWriteItem(params, {
                    heuristic: 'ItemCount',
                    targetItemCount: 4
                });

                expect(dynamoDB.batchWriteItem).toHaveBeenCalledTimes(3);
                expect(response.ConsumedCapacity).toEqual([
                    {
                        CapacityUnits: 21,
                        TableName: 'Test'
                    }
                ]);

            }

            return test();
        }));

        it('should aggregate consumed capacity (INDEXES) from multiple responses', testAsync(() => {
            async function test() {
                let params = _setupBatchWriteItemParams('INDEXES');
                let mock = _setupDynamoDBWrapper();
                let dynamoDB = mock.dynamoDB;
                let dynamoDBWrapper = mock.dynamoDBWrapper;

                spyOn(dynamoDB, 'batchWriteItem').and.callThrough();

                let response = await dynamoDBWrapper.batchWriteItem(params, {
                    heuristic: 'ItemCount',
                    targetItemCount: 4
                });

                expect(dynamoDB.batchWriteItem).toHaveBeenCalledTimes(3);
                expect(response.ConsumedCapacity).toEqual([
                    {
                        CapacityUnits: 21,
                        TableName: 'Test',
                        Table: {
                            CapacityUnits: 6
                        },
                        LocalSecondaryIndexes: {
                            MyLocalIndex: {
                                CapacityUnits: 12
                            }
                        },
                        GlobalSecondaryIndexes: {
                            MyGlobalIndex: {
                                CapacityUnits: 3
                            }
                        }
                    }
                ]);

            }

            return test();
        }));

    });

});