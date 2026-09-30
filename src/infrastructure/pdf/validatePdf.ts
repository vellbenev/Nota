export async function validatePdf(file: File): Promise<void> {
	if (!file.size) throw new Error('This file is empty. Choose a PDF with content.');
	if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
		throw new Error('Choose a PDF file.');
	}
	// PDF headers may follow a short leading byte sequence. This is validation,
	// not parsing: PDF.js still reports corrupt/encrypted document errors.
	const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
	if (!header.includes('%PDF-')) throw new Error('This file does not contain a PDF header.');
}

