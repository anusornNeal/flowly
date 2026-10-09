import { createServer } from './server.js';

const port=Number(process.env.FLOWLY_PORT||3210);
const app=await createServer();
try {
 await app.listen({host:'127.0.0.1',port});
 console.log('Flowly API listening on http://127.0.0.1:'+port);
} catch(error){
 console.error('Flowly could not start:',String(error));
 process.exitCode=1;
}
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{app.close().then(()=>process.exit(0));});
