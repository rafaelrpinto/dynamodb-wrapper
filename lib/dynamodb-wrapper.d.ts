declare interface IDynamoDBWrapperOptions {
    tableNamePrefix?: string;
    groupDelayMs?: number;
    maxRetries?: number;
    retryDelayOptions?: {
        base?: number;
        customBackoff?: Function;
    };
}

declare interface IBatchWriteItemOptions {
    partitionStrategy?: 'EqualItemCount' | 'EvenlyDistributedGroupWCU';
    targetItemCount?: number;
    targetGroupWCU?: number;
    groupDelayMs?: number;
}

declare interface IQueryOptions {
    groupDelayMs?: number;
}

declare interface IScanOptions {
    groupDelayMs?: number;
}

declare type TDictionary<T> = { [key: string] : T; };

declare type TDynamoDBItem = TDictionary<AttributeValue>;

declare type AttributeValue = {
    S?: string;
    N?: string;
    B?: any;
    SS?: string[];
    NS?: string[];
    BS?: any[];
    M?: any;
    L?: any;
    NULL?: boolean;
    BOOL?: boolean;
}