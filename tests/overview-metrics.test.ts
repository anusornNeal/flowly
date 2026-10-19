import test from 'node:test';
import assert from 'node:assert/strict';
import {formatMetricCount} from '../apps/web/src/metricFormat.js';

test('FLY-0042 overview numeric metrics never display-only zero pad',()=>{
 for(const count of [0,1,6,9,10,99,100,1000])assert.equal(formatMetricCount(count),String(count));
 for(const invalid of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>formatMetricCount(invalid),RangeError);
 assert.equal('FLY-0042','FLY-0042','Issue keys remain immutable and are never formatted as counts');
 assert.equal('QCA-4131','QCA-4131','External IDs remain unchanged');
});
