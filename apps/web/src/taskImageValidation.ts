export const TASK_IMAGE_LIMIT = 10;
export const TASK_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const TASK_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

/** Advisory checks only; the API independently decodes and validates bytes. */
export function validateTaskImage(file: Pick<File, 'type' | 'size'>): string | undefined {
 if (!TASK_IMAGE_ACCEPT.split(',').includes(file.type)) return 'Use a PNG, JPEG or WebP image.';
 if (file.size === 0) return 'This file is empty.';
 if (file.size > TASK_IMAGE_MAX_BYTES) return 'Image exceeds 25 MiB.';
 return undefined;
}
