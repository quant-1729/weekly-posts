// Where the files of a face being made live: next to the pose images (see ../paths.ts), inside the face's folder, so
// retiring the face and deleting the account remove them too. The database holds the "{bucket}/..." form.

import { FACE_BUCKET, faceFolder } from '../paths';

export const faceOptionRel = (brandId: string, faceId: string, index: number) => `${faceFolder(brandId, faceId)}/options/${index}.png`;
export const faceMasterRel = (brandId: string, faceId: string) => `${faceFolder(brandId, faceId)}/master.png`;
/** A made sheet the owner has not approved yet. */
export const faceSheetDraftRel = (brandId: string, faceId: string) => `${faceFolder(brandId, faceId)}/sheet-draft.png`;
/** The approved sheet (brand_faces.sheet_path points here). */
export const faceSheetRel = (brandId: string, faceId: string) => `${faceFolder(brandId, faceId)}/sheet.png`;

export const toStored = (rel: string) => `${FACE_BUCKET}/${rel}`;
