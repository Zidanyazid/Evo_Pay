const attempts=new Map();const WINDOW=15*60_000,LIMIT=8,MAX_KEYS=20_000;
const key=(req,prefix)=>`${prefix}|${req.ip}|${String(req.body?.email||req.body?.username||'').trim().toLowerCase()}`;
const throttle=(prefix,code,message)=>function(req,res,next){const k=key(req,prefix),t=Date.now();let x=attempts.get(k);if(!x||x.reset<=t)x={count:0,reset:t+WINDOW};if(x.count>=LIMIT){const seconds=Math.max(1,Math.ceil((x.reset-t)/1000));res.set('Retry-After',String(seconds));return res.status(429).json({error:{code,message}})}req.recordThrottleFailure=()=>{x.count++;attempts.set(k,x);if(attempts.size>MAX_KEYS)for(const [id,value] of attempts){if(value.reset<=Date.now()||attempts.size>MAX_KEYS)attempts.delete(id)}};req.resetThrottle=()=>attempts.delete(k);next();};
export const loginThrottle=throttle('login','LOGIN_RATE_LIMITED','Terlalu banyak percobaan login. Coba kembali nanti.');
export const registrationThrottle=throttle('register','REGISTRATION_RATE_LIMITED','Terlalu banyak percobaan pendaftaran. Coba kembali nanti.');

export const passwordResetThrottle=throttle('password-reset','PASSWORD_RESET_RATE_LIMITED','Terlalu banyak permintaan reset. Coba kembali nanti.');
