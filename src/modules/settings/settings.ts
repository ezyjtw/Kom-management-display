import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { SETTINGS, type SettingKey, type SettingValue } from "@/modules/settings/registry";

/** Read a setting; missing or invalid values fall back to the (safe) default. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const def = SETTINGS[key];
  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (!row) return def.default as SettingValue<K>;
    const parsed = def.schema.safeParse(row.value);
    if (parsed.success) return parsed.data as SettingValue<K>;
    logger.warn("Invalid stored setting; using default", { key });
  } catch (error) {
    logger.warn("Could not read setting; using default", { key, error: error instanceof Error ? error.message : String(error) });
  }
  return def.default as SettingValue<K>;
}

export async function getSettings<K extends SettingKey>(keys: readonly K[]): Promise<{ [P in K]: SettingValue<P> }> {
  const out = {} as { [P in K]: SettingValue<P> };
  for (const k of keys) out[k] = await getSetting(k);
  return out;
}

export async function writeSetting<K extends SettingKey>(key: K, value: SettingValue<K>, updatedById: string | null): Promise<void> {
  const json = (value === null ? Prisma.JsonNull : value) as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: json, updatedById },
    create: { key, value: json, updatedById },
  });
}
