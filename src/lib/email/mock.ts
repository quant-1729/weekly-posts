import { writeOutbox } from "./outbox";
import type { EmailTransport } from "./types";

/** Default transport: writes the email to the outbox folder and sends nothing. */
export function createMockEmail(): EmailTransport {
  return {
    async send(input) {
      const entry = await writeOutbox(input);
      return { id: entry.id };
    },
  };
}
