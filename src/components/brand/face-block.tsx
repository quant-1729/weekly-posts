import { CHARACTER_LABELS } from "@/lib/characters/types";
import { loadFaceCard } from "@/lib/faces/card";
import { characterGallery, characterPoses } from "@/lib/faces/character-preview";
import { getMascotCard } from "@/lib/mascot/service";
import { DEFAULT_TWEEN_COLORS } from "@/lib/mascot/colors";
import { FaceCard } from "./face-card";

/**
 * The "Brand face" card of the Brand page (F-4). It replaces the Mascot card: the mascot is one kind of face and keeps
 * everything its own card had, and now offers a gallery of characters (CH-3). Server component: loads the faces and the
 * mascot card, draws the character previews in the brand's colours (cached per colours), and hands them to the client card.
 */
export async function FaceBlock({ userId, brandId }: { userId: string; brandId: string }) {
  const [data, mascot] = await Promise.all([loadFaceCard(userId, brandId), getMascotCard(userId, brandId)]);
  const colors = mascot.colors ?? DEFAULT_TWEEN_COLORS;
  const face = data.faces.find((f) => f.kind === "mascot" && f.id === data.activeFaceId && f.status === "approved") ?? data.faces.find((f) => f.kind === "mascot" && f.status === "approved");
  const selected = face?.character ?? "tween";
  const gallery = {
    items: characterGallery(colors),
    selected,
    name: face && face.name !== CHARACTER_LABELS[selected] ? face.name : "",
    poses: characterPoses(selected, colors),
  };
  return (
    <FaceCard
      brandId={brandId}
      initial={data}
      mascot={{ reason: mascot.eligibility.reason, active: mascot.active, inPosts: mascot.inPosts, colors: mascot.colors, gallery }}
    />
  );
}
