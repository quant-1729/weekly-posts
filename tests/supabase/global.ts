import { closeRawDb, leftovers, sweepAll } from "./sweep";

/** Before the run: clear leftovers of a crashed run. After it: sweep again and fail if anything remains. */
export async function setup(): Promise<void> {
  await sweepAll();
  await closeRawDb();
}

export async function teardown(): Promise<void> {
  await sweepAll();
  const left = await leftovers();
  await closeRawDb();
  console.log(
    `[supabase-it] left in the project: it- auth users=${left.authUsers}, it- brands=${left.brands}, it- magic links=${left.magicLinks}, test storage objects=${left.storageObjects}`,
  );
  if (left.authUsers + left.brands + left.magicLinks + left.storageObjects > 0) {
    throw new Error("The Supabase integration tests left data behind.");
  }
}
