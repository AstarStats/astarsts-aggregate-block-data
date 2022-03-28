import {hexDataSlice, stripZeros} from '@ethersproject/bytes';
import {EventRecord} from "@polkadot/types/interfaces"
import { SubstrateBlock, SubstrateExtrinsic } from "@subql/types";

export function inputToFunctionSighash(input: string): string {
    return hexDataSlice(input, 0, 4);
}

export function isContractFunction(input: string): boolean {
    return false === isZero(input);
}

export function isInputCreateContract(input: string): boolean {
    return ((hexDataSlice(input, 0, 1) === "0x60") && (hexDataSlice(input, 2, 4) === "0x6040"));
}

export function isZero(input: string): boolean {
    return stripZeros(input).length === 0;
}

export function getExtrinsicsGas(_extrinsics: SubstrateExtrinsic[]): bigint {
    const modlPotStakeADDRESS = "YQnbw3h6couUX48Ghs3qyzhdbyxA3Gu9KQCoi8z2CPBf9N3";

    var _gasUsedCount = BigInt(0);
    _extrinsics.forEach(evts =>{
      if(evts.success){

        evts.events.forEach((evt)=>{
          const [address, balance] =  evt.event.data.toJSON() as [string, bigint];
  
          if(evt.event.method === "Deposit" && evt.event.section === "balances" && address === modlPotStakeADDRESS){
            _gasUsedCount += BigInt(balance);
          }
        })
      }
    });

    return _gasUsedCount;
}

function filterExtrinsicEvents(
    extrinsicIdx: number,
    events: EventRecord[],
): EventRecord[] {
    return events.filter(
        ({ phase }) =>
            phase.isApplyExtrinsic && phase.asApplyExtrinsic.eqn(extrinsicIdx),
    );
}

export function wrapExtrinsics(
    wrappedBlock: SubstrateBlock,
): SubstrateExtrinsic[] {
    return wrappedBlock.block.extrinsics.map((extrinsic, idx) => {
        const events = filterExtrinsicEvents(idx, wrappedBlock.events);
        return {
            idx,
            extrinsic,
            block: wrappedBlock,
            events,
            success: getExtrinsicSuccess(events),
        };
    });
}

export function getExtrinsics(
    wrappedBlock: SubstrateBlock,
): SubstrateExtrinsic[] {
    return wrappedBlock.block.extrinsics.map((extrinsic, idx) => {
        const events = filterExtrinsicEvents(idx, wrappedBlock.events);
        return {
            idx,
            extrinsic,
            block: wrappedBlock,
            events,
            success: getExtrinsicSuccess(events),
        };
    });
}

function getExtrinsicSuccess(events: EventRecord[]): boolean {
    return (
        events.findIndex((evt) => evt.event.method === 'ExtrinsicSuccess') > -1
    );
}