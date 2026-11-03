import type { ReaderStage } from "@core/src/features/orders/domain/reader/readings";
import type { ReaderStages } from "@core/src/features/orders/application/reader/stages";

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

export type ReaderStageContracts = [
  // One confirming flag per stage.
  Assert<Equal<keyof ReaderStages["confirms"], ReaderStage>>,
];
