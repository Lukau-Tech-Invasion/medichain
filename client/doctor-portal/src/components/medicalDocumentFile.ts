import type { RecordType, UploadMedicalRecordRequest } from '@medichain/shared';

/** A file validation message that is safe to show without exposing an unexpected exception. */
export class MedicalDocumentFileError extends Error {}

/** Validate a bounded document's declared MIME and signature before encoding it for upload. */
export async function prepareMedicalDocument(file: File, patientId: string, recordType: RecordType): Promise<UploadMedicalRecordRequest> {
  const signatures: Record<string, (header: string) => boolean> = {
    'application/pdf': header => header.startsWith('%PDF-'),
    'image/png': header => header === '\x89PNG\r\n\x1a\n',
    'image/jpeg': header => header.startsWith('\xff\xd8\xff'),
  };
  if (!patientId || !file.size || file.size > 1024 * 1024 || !signatures[file.type]) {
    throw new MedicalDocumentFileError('Choose a PDF, PNG or JPEG document, up to 1 MiB.');
  }
  const encoded = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new MedicalDocumentFileError('The file could not be read. Please choose it again.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });
  if (!signatures[file.type](atob(encoded).slice(0, 8))) {
    throw new MedicalDocumentFileError('The file contents do not match its PDF, PNG or JPEG type.');
  }
  return { patient_id: patientId, content_base64: encoded, filename: file.name,
    content_type: file.type, record_type: recordType };
}
