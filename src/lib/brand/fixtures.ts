import type { SetupExtract } from "@/lib/ai/schemas";

/**
 * Sample answers for the dev flow without AI (AI_MODE=fixture, no credentials,
 * and all tests): the Hindi sweet shop "brand-sweets" from test-data/brands.json.
 * Live mode ignores these.
 */
export const SETUP_EXTRACT_FIXTURE: SetupExtract = {
  business_name: "श्री राम स्वीट्स",
  category: "sweet shop",
  city: "Indore, Sarafa Road",
  products: [
    { name: "काजू कतली", price: "600", unit: "per kg", note: "gift box packing available" },
    { name: "मलाई बर्फी", price: "480", unit: "per kg", note: "" },
    { name: "जलेबी", price: "240", unit: "per kg", note: "fresh every morning" },
    { name: "समोसा", price: "20", unit: "per piece", note: "evening batch from 6 PM" },
    { name: "बेसन लड्डू", price: "", unit: "per kg", note: "" },
  ],
  audience: "families and local office-goers in Indore, festival gift buyers",
  notes: "Shop open 8 AM to 10 PM daily; Address: 14 Sarafa Road, Indore; Gift boxes made on order",
  unclear: ["Price of बेसन लड्डू was not said"],
};

/** A fixed Hindi voice-note transcript, returned by the transcription step in fixture mode. */
export const SETUP_TRANSCRIPT_FIXTURE =
  "मेरी दुकान का नाम श्री राम स्वीट्स है, इंदौर में सराफा रोड पर। हम काजू कतली छह सौ रुपये किलो, मलाई बर्फी चार सौ अस्सी रुपये किलो, जलेबी दो सौ चालीस रुपये किलो और समोसा बीस रुपये का एक बेचते हैं। बेसन लड्डू भी हैं। हमारे ग्राहक परिवार और आसपास के ऑफिस वाले लोग हैं। दुकान सुबह आठ बजे से रात दस बजे तक खुली रहती है।";
