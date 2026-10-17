import { DEFAULT_VALIDATION_SETTINGS, ValidationSettingsSchema, ValidationCategorySchema, type ValidationSettings } from '@vidarr/shared-types';
import { prisma } from '../db/client.js';

export { validationCategoryForSource } from '../catalog/musicVideoPolicy.js';

export async function loadValidationSettings(): Promise<ValidationSettings> {
  const row = await prisma.settings.findUnique({ where: { id: 1 }, select: { validationSettings: true } });
  if (!row) return structuredClone(DEFAULT_VALIDATION_SETTINGS);
  // Invalid stored policy must fail visibly, never silently disable inspections.
  return ValidationSettingsSchema.parse(JSON.parse(row.validationSettings));
}

export async function validationOptions(category: string) {
  const key = ValidationCategorySchema.safeParse(category);
  const resolved = key.success ? key.data : 'additional';
  const settings = await loadValidationSettings();
  return { category: resolved, checkVideoFile: settings.policies[resolved].file, checkVideoMotion: settings.policies[resolved].motion,
    minimumDimension: settings.minimumDimension, maximumStaticFraction: settings.maximumStaticPercent / 100 };
}
