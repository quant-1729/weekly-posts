import { InstagramCard } from "@/components/instagram/instagram-card";
import { getInstagramState } from "@/lib/instagram/import";
import { s } from "@/lib/i18n/strings";
import { listPastPosts } from "@/lib/uploads/past-posts";
import { listPhotos } from "@/lib/uploads/photos";
import { getVoice } from "@/lib/uploads/voice";
import { PastPosts } from "./past-posts";
import { PhotoLibrary } from "./photo-library";
import { VoiceCard } from "./voice-card";

/**
 * "Photos and past posts": the photo library, past posts and, unless `voice` is false, the voice read
 * from them. Self-contained (loads its own data), so any page can mount it with just the user and brand.
 * `heading` is false when the page already puts its own title above (the /brand page does).
 */
export async function UploadsSection({
  userId,
  brandId,
  voice = true,
  heading = true,
}: {
  userId: string;
  brandId: string;
  voice?: boolean;
  heading?: boolean;
}) {
  const [photos, pastPosts, voiceView, instagram] = await Promise.all([
    listPhotos(userId, brandId),
    listPastPosts(userId, brandId),
    voice ? getVoice(userId, brandId) : Promise.resolve(null),
    getInstagramState(userId, brandId), // database only; Instagram itself is never called on page load
  ]);
  return (
    <section className={heading ? "space-y-6 border-t border-stone-200 pt-6" : "space-y-6"} aria-labelledby={heading ? "uploads-heading" : undefined}>
      {heading && (
        <div>
          <h2 id="uploads-heading" className="text-xl font-medium">
            {s.uploads.sectionTitle}
          </h2>
          <p className="text-[14px] leading-5 text-desc">{s.uploads.sectionIntro}</p>
        </div>
      )}
      <InstagramCard brandId={brandId} initial={instagram} />
      {/* The key changes only when Instagram photos or posts do, so the lists below pick up what the Instagram card added. */}
      <PhotoLibrary
        key={`photos:${photos.filter((p) => p.source === "instagram").map((p) => p.id).join(",")}`}
        brandId={brandId}
        initialPhotos={photos}
      />
      <PastPosts
        key={`past:${pastPosts.filter((p) => p.source === "instagram").map((p) => p.id).join(",")}`}
        brandId={brandId}
        initialPosts={pastPosts}
      />
      {voiceView && <VoiceCard brandId={brandId} voice={voiceView} hasPastPosts={pastPosts.length > 0} />}
    </section>
  );
}

/** The voice card alone, for pages that show it in its own section. */
export async function VoiceSection({ userId, brandId }: { userId: string; brandId: string }) {
  const [voice, pastPosts] = await Promise.all([getVoice(userId, brandId), listPastPosts(userId, brandId)]);
  return <VoiceCard brandId={brandId} voice={voice} hasPastPosts={pastPosts.length > 0} />;
}
