import type { Channel, ChannelOutput, ContentLanguage, GenerateResult } from "@/lib/ai/schemas";

/**
 * Sample generate results for the dev flow without AI (AI_MODE=fixture, no
 * credentials, and all tests): the Hindi sweet shop "brand-sweets" from
 * test-data/brands.json. Every number below is also in that brand's memory
 * (काजू कतली 600), so the fact check finds nothing to flag. Live mode ignores these.
 */

const hiIg: ChannelOutput = {
  caption:
    "ताज़ी काजू कतली अब आपकी दुकान पर 🍬\nघर की मिठास, हर टुकड़े में।\nकाजू कतली ₹600 प्रति किलो। गिफ़्ट बॉक्स भी मिलता है।",
  cta: "ऑर्डर के लिए WhatsApp करें",
  hashtags: ["#IndoreSweets", "#ShriRamSweets", "#KajuKatli", "#SarafaRoad", "#MithaiLovers"],
  image_text: { headline: "ताज़ी काजू कतली", subline: "₹600 प्रति किलो", bubble: "" },
};

const hiStatus: ChannelOutput = {
  caption: "आज की ताज़ी काजू कतली, ₹600 किलो 🍬",
  cta: "WhatsApp पर ऑर्डर करें",
  hashtags: [],
  image_text: { headline: "ताज़ी काजू कतली", subline: "₹600 प्रति किलो", bubble: "" },
};

const hiFacebook: ChannelOutput = {
  caption:
    "नमस्ते! श्री राम स्वीट्स, सराफा रोड, इंदौर में आज ताज़ी काजू कतली तैयार है।\nशुद्ध सामग्री से बनी, हर टुकड़ा मुँह में घुल जाए।\nकाजू कतली ₹600 प्रति किलो। गिफ़्ट बॉक्स में पैकिंग भी ऑर्डर पर उपलब्ध है।",
  cta: "ऑर्डर के लिए WhatsApp पर मैसेज करें",
  hashtags: ["#IndoreSweets", "#ShriRamSweets"],
  image_text: { headline: "", subline: "", bubble: "" },
};

const hiGbp: ChannelOutput = {
  caption:
    "श्री राम स्वीट्स, सराफा रोड, इंदौर में ताज़ी काजू कतली उपलब्ध है। कीमत ₹600 प्रति किलो। गिफ़्ट बॉक्स में पैकिंग ऑर्डर पर की जाती है।",
  cta: "ऑर्डर के लिए WhatsApp पर मैसेज करें",
  hashtags: [],
  image_text: { headline: "", subline: "", bubble: "" },
};

const hinglishOutputs: GenerateResult["outputs"] = {
  ig_feed: {
    caption:
      "Fresh kaju katli ab aapki dukaan par 🍬\nGhar ki mithaas, har tukde mein.\nKaju katli ₹600 per kg. Gift box bhi milta hai.",
    cta: "Order ke liye WhatsApp karein",
    hashtags: ["#IndoreSweets", "#ShriRamSweets", "#KajuKatli", "#SarafaRoad", "#MithaiLovers"],
    image_text: { headline: "Fresh Kaju Katli", subline: "₹600 per kg", bubble: "" },
  },
  status: {
    caption: "Aaj ki fresh kaju katli, ₹600 kg 🍬",
    cta: "WhatsApp par order karein",
    hashtags: [],
    image_text: { headline: "Fresh Kaju Katli", subline: "₹600 per kg", bubble: "" },
  },
  facebook: {
    caption:
      "Namaste! Shri Ram Sweets, Sarafa Road, Indore mein aaj fresh kaju katli taiyaar hai.\nShuddh samagri se bani, har tukda munh mein ghul jaye.\nKaju katli ₹600 per kg. Gift box packing order par milti hai.",
    cta: "Order ke liye WhatsApp par message karein",
    hashtags: ["#IndoreSweets", "#ShriRamSweets"],
    image_text: { headline: "", subline: "", bubble: "" },
  },
  gbp: {
    caption:
      "Shri Ram Sweets, Sarafa Road, Indore mein fresh kaju katli available hai. Price ₹600 per kg. Gift box packing order par ki jaati hai.",
    cta: "Order ke liye WhatsApp par message karein",
    hashtags: [],
    image_text: { headline: "", subline: "", bubble: "" },
  },
};

const enOutputs: GenerateResult["outputs"] = {
  ig_feed: {
    caption:
      "Fresh kaju katli is ready at our shop 🍬\nHomemade sweetness in every piece.\nKaju katli ₹600 per kg. Gift boxes available too.",
    cta: "Order on WhatsApp",
    hashtags: ["#IndoreSweets", "#ShriRamSweets", "#KajuKatli", "#SarafaRoad", "#MithaiLovers"],
    image_text: { headline: "Fresh Kaju Katli", subline: "₹600 per kg", bubble: "" },
  },
  status: {
    caption: "Today's fresh kaju katli, ₹600 per kg 🍬",
    cta: "Order on WhatsApp",
    hashtags: [],
    image_text: { headline: "Fresh Kaju Katli", subline: "₹600 per kg", bubble: "" },
  },
  facebook: {
    caption:
      "Hello from Shri Ram Sweets, Sarafa Road, Indore! Fresh kaju katli is ready today.\nMade with pure ingredients, it melts in your mouth.\nKaju katli ₹600 per kg. Gift box packing is available on order.",
    cta: "Message us on WhatsApp to order",
    hashtags: ["#IndoreSweets", "#ShriRamSweets"],
    image_text: { headline: "", subline: "", bubble: "" },
  },
  gbp: {
    caption:
      "Shri Ram Sweets, Sarafa Road, Indore now has fresh kaju katli. Price: ₹600 per kg. Gift box packing is available on order.",
    cta: "Message us on WhatsApp to order",
    hashtags: [],
    image_text: { headline: "", subline: "", bubble: "" },
  },
};

/** A valid result for the sweet shop, in the requested language. */
export function generateFixture(language: ContentLanguage = "hi"): GenerateResult {
  const outputs =
    language === "hi"
      ? { ig_feed: hiIg, status: hiStatus, facebook: hiFacebook, gbp: hiGbp }
      : language === "hinglish"
        ? hinglishOutputs
        : enOutputs;
  return {
    status: "ok",
    message_to_owner: "",
    summary: "Fresh kaju katli at 600 rupees per kg, gift boxes on order",
    outputs: structuredClone(outputs),
    facts_used: [
      { text: "₹600 प्रति किलो", kind: "price", source: "brand_memory" },
      { text: "गिफ़्ट बॉक्स", kind: "claim", source: "brand_memory" },
    ],
  };
}

/**
 * A valid switch-language result for the sweet shop: one channel's output in the
 * requested language (fixture mode only). Same texts as `generateFixture`, so the
 * numbers (₹600) are in the sources and nothing is flagged.
 */
export function switchFixture(channel: Channel, language: ContentLanguage): ChannelOutput {
  return generateFixture(language).outputs[channel];
}

/** The model could not tell what to post about: asks the owner to resend or type. */
export function needsInputFixture(): GenerateResult {
  const empty: ChannelOutput = { caption: "", cta: "", hashtags: [], image_text: { headline: "", subline: "", bubble: "" } };
  return {
    status: "needs_input",
    message_to_owner: "हमें आपकी बात साफ़ समझ नहीं आई। कृपया फिर से भेजें या लिखकर बताएं।",
    summary: "",
    outputs: { ig_feed: empty, status: empty, facebook: empty, gbp: empty },
    facts_used: [],
  };
}

/** A Hindi voice-note transcript for a post, returned by the transcription step in fixture mode. */
export const POST_TRANSCRIPT_FIXTURE =
  "आज ताज़ी काजू कतली बनी है, छह सौ रुपये किलो। गिफ़्ट बॉक्स में भी मिल जाएगी।";
