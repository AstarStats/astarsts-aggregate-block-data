import {DailyCount} from "../types/models/DailyCount";
import {MonthlyCount} from "../types/models/MonthlyCount";
import {AggregateData} from "../types/models/AggregateData";
import {isHexString} from '@ethersproject/bytes';

import {SubstrateBlock} from "@subql/types";
import FrontierEvmDatasourcePlugin, { FrontierEvmCall } from "@subql/contract-processors/dist/frontierEvm";
import { isInputCreateContract, isContractFunction, wrapExtrinsics, getExtrinsicsGas } from "../utils";

type TransferExtrinscArgs = [string, bigint] & { dest: string; value: bigint; };

/**
 * @fn substrate block handler
 * @param thisBlock substrate block
 */
export async function handleBlock(thisBlock: SubstrateBlock): Promise<void> {

  const _aggregateData = await extractAggregateData(thisBlock);

  const recordDailyCount = aggregateAsDailyCount(_aggregateData);
  const recordMonthlyCount = aggregateAsMonthlyCount(_aggregateData);

  await Promise.all(
    [
      (await recordDailyCount).save(),
      (await recordMonthlyCount).save()
    ]
  );
}

/**
 * 
 * @param thisBlock block
 * @returns extract aggregate data from block
 */
 async function extractAggregateData(thisBlock: SubstrateBlock) :Promise<AggregateData>{
  
  let _aggregateData = new AggregateData("__");
  _aggregateData.createdAt = thisBlock.timestamp;
  _aggregateData.dailyTimestamp = _aggregateData.createdAt.toISOString().slice(0,10);
  _aggregateData.monthlyTimestamp = _aggregateData.createdAt.toISOString().slice(0,7);
  
  const _wrapedExtinsics = wrapExtrinsics(thisBlock);
  const _nativeTransaction = _wrapedExtinsics.filter((ext) => ext.extrinsic.method.section !== 'ethereum' || ext.extrinsic.method.method !== 'transact');
  const _evmTransaction = _wrapedExtinsics.filter((ext) => ext.extrinsic.method.section === 'ethereum' && ext.extrinsic.method.method === 'transact');

  const _evmCalls: FrontierEvmCall[] = await Promise.all(
    _evmTransaction.map( (ext) => FrontierEvmDatasourcePlugin.handlerProcessors['substrate/FrontierEvmCall'].transformer(ext, {} as any, undefined, undefined))
  ) as any;

  // #####################################################################
  // ** Tx counts
  // #####################################################################
  // native
  // =====================================================================
  _aggregateData.nativeExtinsicCount = BigInt(_nativeTransaction.length);
  _aggregateData.nativeExtinsicSuccessCount = BigInt(_nativeTransaction.filter(tx => tx.success).length);

  // =====================================================================
  // EVM 
  // =====================================================================
  _aggregateData.evmTransactionCount = BigInt(_evmCalls.length);
  _aggregateData.evmTransactionSuccessCount = BigInt( _evmCalls.filter(tx => tx.success).length );

  // #####################################################################
  // ** Gas used
  // #####################################################################
  
  // =====================================================================
  // native
  // =====================================================================
  _aggregateData.nativeGasUsedCount = getExtrinsicsGas( _nativeTransaction.filter(
    (ext) => ext.extrinsic.method.section !== 'timestamp' || ext.extrinsic.method.method !== 'set')
  );

  // =====================================================================
  // EVM
  // =====================================================================
  _aggregateData.evmGasUsedCount = getExtrinsicsGas(_evmTransaction);

  // #####################################################################
  // ** Unique Contracts Deployed and Developpers
  // #####################################################################
  _aggregateData.nativeContractDeployed = [];
  _aggregateData.evmContractDeployed = [];

  _aggregateData.nativeContractDevelopers = [];
  _aggregateData.evmContractDevelopers = [];

  // =====================================================================
  // native
  // =====================================================================
  // NO support

  // =====================================================================
  // EVM
  // =====================================================================
  _evmCalls.filter(tx => isInputCreateContract(tx.data)).forEach(evt => {
    _aggregateData.evmContractDeployed.push(evt.to);
    _aggregateData.evmContractDevelopers.push(evt.from);
  })
  
  // #####################################################################
  // ** Active Addresses
  // #####################################################################
  // native
  // =====================================================================
  _aggregateData.nativeActiveUsers = [];
  _nativeTransaction.forEach(ext => {
    
    // Sender
    var _addr = ext.extrinsic.signer.toString();
    
    if(undefined === _aggregateData.nativeActiveUsers.find(addr => addr === _addr)){
      _aggregateData.nativeActiveUsers.push(_addr);
    }
    
    // Destination
    if("balances" === ext.extrinsic.method.section ){
      const [dest, value] =  ext.extrinsic.args as unknown as TransferExtrinscArgs;
      
      if(isHexString(dest.toString())){
        logger.info("dest: " + ext.block.timestamp + " " + dest.toString() +" " + ext.extrinsic.method.method);
      }
      if(undefined === _aggregateData.nativeActiveUsers.find(addr => addr === dest.toString())){
        _aggregateData.nativeActiveUsers.push(dest.toString());
      }
    }
  });

  // =====================================================================
  // EVM
  // =====================================================================
  _aggregateData.evmActiveUsers = [];
  _evmCalls.forEach(ext => {

    // from
    var _addr = ext.from;
    if(undefined === _aggregateData.evmActiveUsers.find(addr => addr === _addr)){
      // no duplicate
      _aggregateData.evmActiveUsers.push(_addr);
    }

    // to
    if(false === isContractFunction(ext.data)){
      // except contract operation
      _addr = ext.to;
      if(undefined === _aggregateData.evmActiveUsers.find(addr => addr === _addr)){
        // no duplicate
        _aggregateData.evmActiveUsers.push(_addr);
      }
    }
  });
  // =====================================================================  

  _aggregateData.blockHeight = thisBlock.block.header.number.toBigInt();

  return _aggregateData;
}


/**
 * 
 * @param _aggregateData daily data of constructed from new block
 * @returns sum of {_aggregateData} and database (except duplicate data)
 */
 async function aggregateAsDailyCount(_aggregateData: AggregateData) :Promise<DailyCount>{
  let entity = await DailyCount.get(_aggregateData.dailyTimestamp);
  if (undefined === entity){
    //  {dailyTimestamp} is not registerd at database
    entity = createDailyCount(_aggregateData.dailyTimestamp);
  }

  entity.nativeExtinsicCount += _aggregateData.nativeExtinsicCount;
  entity.nativeExtinsicSuccessCount += _aggregateData.nativeExtinsicSuccessCount;
  entity.evmTransactionCount += _aggregateData.evmTransactionCount;
  entity.evmTransactionSuccessCount += _aggregateData.evmTransactionSuccessCount;

  entity.nativeGasUsedCount += _aggregateData.nativeGasUsedCount;
  entity.evmGasUsedCount += _aggregateData.evmGasUsedCount;

  _aggregateData.nativeContractDeployed.forEach(nativeContractDeployed => {
    if(undefined === entity.nativeContractDeployed.find((addr)=> addr === nativeContractDeployed)){
      // no duplicate
      entity.nativeContractDeployed.push(nativeContractDeployed);
    }
  })
  _aggregateData.evmContractDeployed.forEach(evmContractDeployed => {
    if(undefined === entity.evmContractDeployed.find((addr)=> addr === evmContractDeployed)){
      // no duplicate
      entity.evmContractDeployed.push(evmContractDeployed);
    }
  })
  _aggregateData.nativeContractDevelopers.forEach(nativeContractDevelopers => {
    if(undefined === entity.nativeContractDevelopers.find((addr)=> addr === nativeContractDevelopers)){
      // no duplicate
      entity.nativeContractDevelopers.push(nativeContractDevelopers);
    }
  })
  _aggregateData.evmContractDevelopers.forEach(evmContractDevelopers => {
    if(undefined === entity.evmContractDevelopers.find((addr)=> addr === evmContractDevelopers)){
      // no duplicate
      entity.evmContractDevelopers.push(evmContractDevelopers);
    }
  })
  _aggregateData.nativeActiveUsers.forEach(nativeActiveUsers => {
    if(undefined === entity.nativeActiveUsers.find((addr)=> addr === nativeActiveUsers)){
      // no duplicate
      entity.nativeActiveUsers.push(nativeActiveUsers);
    }
  })
  _aggregateData.evmActiveUsers.forEach(evmActiveUsers => {
    if(undefined === entity.evmActiveUsers.find((addr)=> addr === evmActiveUsers)){
      // no duplicate
      entity.evmActiveUsers.push(evmActiveUsers);
    }
  })

  entity.blockHeight = _aggregateData.blockHeight;
  entity.createdAt = _aggregateData.createdAt;

  return entity
}

/**
 * 
 * @param dailyStirng key of new entity
 * @returns new entity
 */
function createDailyCount(dailyStirng: string) :DailyCount{
  const entity = new DailyCount(dailyStirng);
  entity.nativeExtinsicCount = BigInt(0);
  entity.nativeExtinsicSuccessCount = BigInt(0);
  entity.evmTransactionCount = BigInt(0);
  entity.evmTransactionSuccessCount = BigInt(0);
  entity.nativeGasUsedCount = BigInt(0);
  entity.evmGasUsedCount = BigInt(0);
  entity.nativeContractDeployed = [];
  entity.evmContractDeployed = [];
  entity.nativeContractDevelopers = [];
  entity.evmContractDevelopers = [];
  entity.nativeActiveUsers = [];
  entity.evmActiveUsers = [];
  
  return entity
}

/**
 * 
 * @param _aggregateData daily data of constructed from new block
 * @returns sum of {_aggregateData} and database (except duplicate data)
 */
 async function aggregateAsMonthlyCount(_aggregateData: AggregateData) :Promise<MonthlyCount>{
  let entity = await MonthlyCount.get(_aggregateData.monthlyTimestamp);
  if (undefined === entity){
    //  {MonthlyTimestamp} is not registerd at database
    entity = createMonthlyCount(_aggregateData.monthlyTimestamp);
  }

  entity.nativeExtinsicCount += _aggregateData.nativeExtinsicCount;
  entity.nativeExtinsicSuccessCount += _aggregateData.nativeExtinsicSuccessCount;
  entity.evmTransactionCount += _aggregateData.evmTransactionCount;
  entity.evmTransactionSuccessCount += _aggregateData.evmTransactionSuccessCount;

  entity.nativeGasUsedCount += _aggregateData.nativeGasUsedCount;
  entity.evmGasUsedCount += _aggregateData.evmGasUsedCount;

  _aggregateData.nativeContractDeployed.forEach(nativeContractDeployed => {
    if(undefined === entity.nativeContractDeployed.find((addr)=> addr === nativeContractDeployed)){
      // no duplicate
      entity.nativeContractDeployed.push(nativeContractDeployed);
    }
  })
  _aggregateData.evmContractDeployed.forEach(evmContractDeployed => {
    if(undefined === entity.evmContractDeployed.find((addr)=> addr === evmContractDeployed)){
      // no duplicate
      entity.evmContractDeployed.push(evmContractDeployed);
    }
  })
  _aggregateData.nativeContractDevelopers.forEach(nativeContractDevelopers => {
    if(undefined === entity.nativeContractDevelopers.find((addr)=> addr === nativeContractDevelopers)){
      // no duplicate
      entity.nativeContractDevelopers.push(nativeContractDevelopers);
    }
  })
  _aggregateData.evmContractDevelopers.forEach(evmContractDevelopers => {
    if(undefined === entity.evmContractDevelopers.find((addr)=> addr === evmContractDevelopers)){
      // no duplicate
      entity.evmContractDevelopers.push(evmContractDevelopers);
    }
  })
  _aggregateData.nativeActiveUsers.forEach(nativeActiveUsers => {
    if(undefined === entity.nativeActiveUsers.find((addr)=> addr === nativeActiveUsers)){
      // no duplicate
      entity.nativeActiveUsers.push(nativeActiveUsers);
    }
  })
  _aggregateData.evmActiveUsers.forEach(evmActiveUsers => {
    if(undefined === entity.evmActiveUsers.find((addr)=> addr === evmActiveUsers)){
      // no duplicate
      entity.evmActiveUsers.push(evmActiveUsers);
    }
  })

  entity.blockHeight = _aggregateData.blockHeight;
  entity.createdAt = _aggregateData.createdAt;

  return entity
}

/**
 * 
 * @param monthlyStirng key of new entity
 * @returns new entity
 */
function createMonthlyCount(monthlyStirng: string) :MonthlyCount{
  const entity = new MonthlyCount(monthlyStirng);
  entity.nativeExtinsicCount = BigInt(0);
  entity.nativeExtinsicSuccessCount = BigInt(0);
  entity.evmTransactionCount = BigInt(0);
  entity.evmTransactionSuccessCount = BigInt(0);
  entity.nativeGasUsedCount = BigInt(0);
  entity.evmGasUsedCount = BigInt(0);
  entity.nativeContractDeployed = [];
  entity.evmContractDeployed = [];
  entity.nativeContractDevelopers = [];
  entity.evmContractDevelopers = [];
  entity.nativeActiveUsers = [];
  entity.evmActiveUsers = [];
  
  return entity
}
