import crypto from 'node:crypto';
import { PaymentProvider } from './payment-provider.js';
const statuses=new Map();
export class SimulatorProvider extends PaymentProvider {
  constructor(config={}){super();this.secret=config.secret||process.env.SIMULATOR_SECRET||'evopay-simulator';this.circuitOpenUntil=0;}
  configured(){return process.env.SIMULATOR_ENABLED!=='0'}
  capabilities(){return {methods:['QRIS','GOPAY','DANA','OVO','SHOPEEPAY','VA_BCA','VA_BNI','VA_BRI','ALFAMART','INDOMARET'],statusQuery:true,refund:true,disbursement:false,tokenization:true,recurring:true}}
  async createPayment(input){const scenario=String(input.scenario||input.customerName||'').toLowerCase();if(scenario.includes('timeout'))await new Promise((_,reject)=>setTimeout(()=>reject(new Error('Simulator timeout')),50));if(scenario.includes('fail'))throw new Error('Simulator rejected payment');const expiresAt=new Date(Date.now()+30*60000).toISOString();const row={status:scenario.includes('paid')?'PAID':'PENDING',providerTransactionId:`sim_${crypto.randomUUID().slice(0,8)}`,expiresAt};statuses.set(input.reference,row);return {providerReference:input.reference,providerTransactionId:row.providerTransactionId,status:row.status,totalAmount:input.amount,paymentCode:`SIM-${input.reference.slice(-8)}`,paymentUrl:null,qrString:`000201010212SIMULATOR${input.reference}`,expiresAt,instructions:[`Gunakan simulator EvoPay untuk ${input.paymentMethod}.`],raw:{simulator:true,scenario:scenario||'pending'}}}
  async getPaymentStatus(reference){const row=statuses.get(reference)||{status:'PENDING',providerTransactionId:null};return {...row,raw:{simulator:true,reference}}}
  verifyWebhook(payload){const expected=crypto.createHmac('sha256',this.secret).update(`${payload.reference}:${payload.status}`).digest('hex');const a=Buffer.from(expected);const b=Buffer.from(String(payload.signature||''));return a.length===b.length&&crypto.timingSafeEqual(a,b)}
  setStatus(reference,status){const row=statuses.get(reference)||{};statuses.set(reference,{...row,status});return statuses.get(reference)}
}
