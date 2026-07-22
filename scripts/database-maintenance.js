import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import db from '../src/database.js';

const [command,target]=process.argv.slice(2);
const fail=m=>{console.error(m);process.exitCode=1};

if(command==='verify'){
  try{
    const version=await db.get('SELECT VERSION() version');
    const tables=await db.get('SELECT COUNT(*) count FROM information_schema.tables WHERE table_schema=DATABASE()');
    const broken=await db.all(`SELECT table_name,engine FROM information_schema.tables WHERE table_schema=DATABASE() AND engine IS NULL`);
    if(!tables?.count||broken.length)fail(`Database tidak sehat: tables=${tables?.count||0}, invalid=${broken.length}`);
    else console.log(JSON.stringify({database:process.env.DB_NAME,version:version.version,tables:Number(tables.count),integrity:'ok'}));
  }catch(error){fail(error.message)}finally{await db.close()}
}else if(command==='backup'){
  if(!target)fail('Output backup wajib ditentukan.');
  else if(fs.existsSync(target))fail('Output backup sudah ada.');
  else{
    fs.mkdirSync(path.dirname(path.resolve(target)),{recursive:true});
    const args=['--single-transaction','--quick','--routines','--triggers','--host',process.env.DB_HOST||'127.0.0.1','--port',process.env.DB_PORT||'3306','--user',process.env.DB_USER||'root','--result-file',path.resolve(target),process.env.DB_NAME||'nexuspay'];
    const result=spawnSync('mysqldump',args,{env:{...process.env,MYSQL_PWD:process.env.DB_PASSWORD||''},encoding:'utf8'});
    if(result.status!==0)fail(result.stderr?.trim()||'Backup MySQL gagal.');
    else{const hash=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');fs.writeFileSync(`${target}.json`,JSON.stringify({database:process.env.DB_NAME,created_at:new Date().toISOString(),sha256:hash},null,2));console.log(JSON.stringify({backup:path.resolve(target),sha256:hash}))}
  }
}else fail('Gunakan: backup <output> atau verify');
