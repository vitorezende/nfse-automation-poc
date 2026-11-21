import PDFDocument from 'pdfkit';
import type { Nfse, Prestador } from '../generated/prisma/client.js';
import { formatBrl, formatPercent } from './decimal-input.js';

const xmlEscape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Simplified NFS-e XML loosely inspired by the national standard (DPS/NFS-e). Unsigned and fictitious:
 * it only has to look plausible, never to be valid.
 */
export function nfseXml(nfse: Nfse, prestador: Prestador): string {
  const t = (tag: string, value: string | number) => `<${tag}>${xmlEscape(String(value))}</${tag}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- SIMULAÇÃO - SEM VALOR FISCAL. Documento fictício gerado para demonstração. -->
<NFSe xmlns="https://nfse-poc.example/nfse" versao="1.00" ambiente="simulacao">
  <infNFSe>
    ${t('nNFSe', nfse.number ?? '')}
    ${t('cVerif', nfse.verificationCode)}
    ${t('dhEmi', nfse.issuedAt.toISOString())}
    <DPS>
      ${t('nDPS', nfse.rpsNumber)}
      ${t('serie', nfse.rpsSeries)}
      ${t('dCompet', nfse.competencia)}
      <prest>${t('CNPJ', prestador.cnpj)}${t('xNome', prestador.name)}</prest>
      <toma>${t('CNPJ', nfse.tomadorCnpj)}${t('xNome', nfse.tomadorName)}</toma>
      <serv>${t('cServ', nfse.servicoCode)}${t('xDescServ', nfse.servicoDescription)}${t('xDiscriminacao', nfse.discriminacao)}</serv>
      <valores>${t('vServ', nfse.amount.toFixed(2))}${t('pAliq', nfse.issRate.mul(100).toFixed(2))}${t('vISS', nfse.issAmount.toFixed(2))}</valores>
    </DPS>
  </infNFSe>
</NFSe>
`;
}

/** DANFSe: the printable NFS-e, always watermarked as a simulation with no fiscal value. */
export function danfsePdf(nfse: Nfse, prestador: Prestador): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `DANFSe ${nfse.number} - SIMULAÇÃO` } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Watermark first so content prints over it.
    doc.save();
    doc.rotate(-35, { origin: [300, 420] }).fontSize(48).fillColor('#d00000').opacity(0.18);
    doc.text('SIMULAÇÃO', 60, 360, { width: 480, align: 'center' });
    doc.text('SEM VALOR FISCAL', 60, 420, { width: 480, align: 'center' });
    doc.restore();
    // Writing the watermark moved the text cursor; start the content back at the top margin.
    doc.x = doc.page.margins.left;
    doc.y = doc.page.margins.top;

    doc.fillColor('#b00000').fontSize(10).text('SIMULAÇÃO - SEM VALOR FISCAL - DOCUMENTO FICTÍCIO', { align: 'center' });
    doc.moveDown(0.5).fillColor('#000').fontSize(16).text('DANFSe - Documento Auxiliar da NFS-e', { align: 'center' });
    doc.fontSize(10).text('Prefeitura Municipal de Cidade Fictícia', { align: 'center' }).moveDown();

    const row = (label: string, value: string) => {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(value);
    };
    row('Número da NFS-e', nfse.number ?? '');
    row('Código de verificação', nfse.verificationCode);
    row('Data de emissão', nfse.issuedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
    row('RPS', `${nfse.rpsNumber} / ${nfse.rpsSeries}`);
    row('Competência', nfse.competencia);
    doc.moveDown();
    row('Prestador', `${prestador.name} - CNPJ ${prestador.cnpj}`);
    row('Tomador', `${nfse.tomadorName} - CNPJ ${nfse.tomadorCnpj}`);
    doc.moveDown();
    row('Serviço', `${nfse.servicoCode} - ${nfse.servicoDescription}`);
    row('Discriminação', nfse.discriminacao);
    doc.moveDown();
    row('Valor do serviço', formatBrl(nfse.amount));
    row('Alíquota do ISS', formatPercent(nfse.issRate));
    row('Valor do ISS', formatBrl(nfse.issAmount));
    doc.end();
  });
}
