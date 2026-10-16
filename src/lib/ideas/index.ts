// Ideas (trend research). Types are in ./types (orchestrator-owned); the rest is the R-1 to R-5 library.
export * from "./types";
export {
  CompetitorError,
  ResearchSettingsError,
  createCompetitor,
  deleteCompetitor,
  getResearchSettings,
  listCompetitors,
  saveResearchSettings,
  updateCompetitor,
  validateCompetitor,
  type CompetitorErrorCode,
  type CompetitorInput,
  type ResearchSettings,
} from "./competitors";
export { runResearch, type RunArgs } from "./run";
export { researchWindow, inWindow } from "./window";
export { estimateRunUsd, MIN_RUN_USD } from "./cost";
