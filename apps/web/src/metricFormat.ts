/** Render a nonnegative metric without display-only leading zeroes. IDs and dates must never use this formatter. */
export function formatMetricCount(value:number):string {
 if(!Number.isSafeInteger(value)||value<0)throw new RangeError('Metric count must be a nonnegative safe integer');
 return String(value);
}
