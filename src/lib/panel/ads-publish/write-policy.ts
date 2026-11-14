/**
 * Meta yazma / job tetikleme politikası — tek kaynak.
 *
 * Edit yolları (create / save / submit) ASLA job veya Graph yazımı başlatmaz.
 * Yalnızca publish onayı (approve) AdChangeJob oluşturup runner’ı çağırır.
 */

export const PACKAGE_ACTIONS = [
  "save",
  "submit",
  "approve",
  "reject",
] as const;

export type PackageAction = (typeof PACKAGE_ACTIONS)[number];

/** Bu aksiyonlar AdChangeJob oluşturabilir / Meta yazmaya yol açabilir. */
export const ACTIONS_THAT_START_JOB: readonly PackageAction[] = ["approve"];

export function packageActionStartsJob(action: string): boolean {
  return (ACTIONS_THAT_START_JOB as readonly string[]).includes(action);
}

/** Edit-only kullanıcıların kullanmasına izin verilen aksiyonlar. */
export const EDIT_ONLY_SAFE_ACTIONS: readonly PackageAction[] = [
  "save",
  "submit",
];

export function isEditOnlySafeAction(action: string): boolean {
  return (EDIT_ONLY_SAFE_ACTIONS as readonly string[]).includes(action);
}
