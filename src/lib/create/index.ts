// The "Create a post" pipeline (PRD v3 §4, §5.3, §5.4; change C-16): a ready brief becomes real, fact-checked
// posts in every format its channels need.
//
//   contentFromBrief / factsForBrief   by code: what the post says, and what the fact check treats as true
//   writePostCopy                      one Gemini call: headline, subline, CTA text, captions, mascot line
//   checkPost / checkPosts             the guardrail with the brief's facts and per-USP rules
//   ensureDraftPosts                   the copy, cached as draft posts (the AI is called once per brief)
//   saveCopy / chooseDesign               quick edits, and "Use this design" (draw and store every format + carousel)
//   confirmPostFlag / removePostFlag / approveCreatePost / undoCreateApproval   the review step

export * from './types';
export { loadCreateBrand } from './brand';
export {
  CTA_DEFAULT_TEXT,
  QR_LABEL,
  briefFormats,
  channelFormats,
  contentFromBrief,
  factsForBrief,
  offerLineFor,
  primaryFormat,
  shownBlocks,
  showsLogo,
  uspReadable,
} from './content';
export {
  CAPTION_MAX,
  PostCopyError,
  hashtagLimitFor,
  copyChannels,
  hashtagsFor,
  trimCaption,
  validateCopy,
  wordCount,
  writePostCopy,
  type PostCopyDeps,
} from './copy';
export { approvalCheck, blockersFromReport, carryDecisions, checkPost, checkPosts, guardrailChannel } from './check';
export { getTypeDefault, loadDesignAssets, optionsFor, previewOption, reportLines, saveTypeDefault, validOption } from './render';
export {
  CreateError,
  briefFingerprint,
  approveCreatePost,
  checkCopyEdit,
  confirmPostFlag,
  confirmAllPostFlags,
  ensureDraftPosts,
  getPost,
  invalidateDesign,
  listBriefPosts,
  logCreateShare,
  redrawPosts,
  removePostFlag,
  resetToBase,
  saveCopy,
  undoCreateApproval,
  chooseDesign,
  applyStudioDesign,
  wordsOf,
  type CopyEdit,
  type CreateDeps,
  type StudioDrawFn,
} from './posts';
export { getPostFilter, setPostFilter, type FilterImage, type SetFilterResult } from './filter';
export { filterOf } from './posts';
export { describeCreateError, loadDesignPage, loadReviewData, previewForOption, shareTextFor } from './view';
export type { DesignPage, DesignPageData, OptionView, ReviewData, ReviewPost } from './view';
