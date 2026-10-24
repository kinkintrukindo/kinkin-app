import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export function formatRupiah(value) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('Invalid invoiced amount');
  return `Rp ${Number(value).toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
}
export async function createInvoicePdf(journey, logoBytes, { sample = false, signatureBytes } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice - ${journey.invoice || journey.container}`);
  pdf.setAuthor('Kin Kin Trukindo');
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(.106, .247, .376), gold = rgb(.64, .56, .35), muted = rgb(.39, .44, .48);
  const safe = value => String(value ?? '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '-');
  const text = (value, x, y, size = 11, font = regular, color = navy) => page.drawText(safe(value), { x, y, size, font, color });
  const line = (y, color = rgb(.87,.88,.87)) => page.drawLine({start:{x:48,y},end:{x:547,y},thickness:.8,color});
  const wrapped = (value,x,y,width,size=12,font=regular) => {
    let row='', cursor=y;
    for(const word of safe(value).split(/\s+/)){
      if(font.widthOfTextAtSize((row?row+' ':'')+word,size)>width && row){text(row,x,cursor,size,font);row='';cursor-=18;}
      // Bound unusually long references instead of drawing outside the page.
      let tail=word;
      while(font.widthOfTextAtSize(tail,size)>width){let n=tail.length;while(n>1&&font.widthOfTextAtSize(tail.slice(0,n),size)>width)n--;if(row){text(row,x,cursor,size,font);row='';cursor-=18;}text(tail.slice(0,n),x,cursor,size,font);tail=tail.slice(n);cursor-=18;}
      row+=(row?' ':'')+tail;
    }
    if(row)text(row,x,cursor,size,font);
    return cursor;
  };
  const logo = await pdf.embedPng(logoBytes);
  const scale = Math.min(86/logo.width,86/logo.height);
  page.drawImage(logo,{x:45,y:706,width:logo.width*scale,height:logo.height*scale});
  text('KIN KIN TRUKINDO',148,767,19,bold);
  text('FREIGHT & LOGISTICS',149,746,9,bold,gold);
  text('Surabaya, Indonesia',149,726,10,regular,muted);
  line(690,gold);
  text('INVOICE',48,646,31,bold);
  if(sample)text('SAMPLE - DESIGN PREVIEW',354,650,10,bold,gold);
  text('INVOICE REFERENCE',48,611,8,bold,muted);
  wrapped(journey.invoice || 'Not assigned',48,592,310,12,bold);
  text('JOURNEY DATE',402,611,8,bold,muted);
  text(journey.date,402,592,12,bold);
  page.drawRectangle({x:48,y:378,width:499,height:174,color:rgb(.963,.967,.96)});
  text('JOURNEY DETAILS',66,528,9,bold,gold);
  text('DESTINATION',66,496,8,bold,muted);
  const end=wrapped(journey.destination,66,475,455,14,bold);
  if(end<440)throw new Error('Destination is too long for the invoice layout. Contact Kin Kin Trukindo.');
  text('CONTAINER',66,417,8,bold,muted);text(journey.container,66,397,12,bold);
  text('VEHICLE PLATE',330,417,8,bold,muted);text(journey.plate,330,397,12,bold);
  text('Container transport',48,344,12,bold);
  text('Invoiced amount for the journey shown above',48,325,10,regular,muted);
  line(304);
  page.drawRectangle({x:48,y:237,width:499,height:51,color:navy});
  text('INVOICED AMOUNT',66,258,10,bold,rgb(1,1,1));
  const amount=formatRupiah(journey.invoiced);
  text(amount,529-bold.widthOfTextAtSize(amount,20),255,20,bold,rgb(1,1,1));
  text('Currency: Indonesian Rupiah (IDR)',48,217,9,regular,muted);
  text('PAYMENT DETAILS',48,160,9,bold,gold);
  text('Payable to Ekin Njoto Atmodjo',48,140,11,bold);
  text('BCA - 5110187949',48,122,11,regular);
  text('This document covers this journey only. It is not proof of payment.',48,199,9,regular,muted);
  if (signatureBytes) {
    const signature = await pdf.embedPng(signatureBytes);
    const signatureScale = Math.min(150 / signature.width, 60 / signature.height);
    page.drawImage(signature, {
      x: 354, y: 93,
      width: signature.width * signatureScale,
      height: signature.height * signatureScale,
    });
  }
  page.drawLine({start:{x:354,y:91},end:{x:547,y:91},thickness:.8,color:gold});
  text('Ekin Njotoatmodjo, CEO',354,74,10,bold);
  line(59);
  text('KIN KIN TRUKINDO',48,44,8,bold,gold);
  text('Pergudangan Mutiara Blok A-11, Tambak Langon, Asem Rowo, Surabaya, Indonesia 60184',48,31,8,regular,muted);
  text('Tel / WhatsApp: +62 813-3332-6699',48,18,8,regular,muted);
  text('1 / 1',524,18,8,regular,muted);
  return pdf.save();
}
