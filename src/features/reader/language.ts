export function routeLanguage(text: string): 'translate' | 'clarify' | 'mixed' {
	const rtl = /[\u0600-\u06ff]/u.test(text),
		latin = /[A-Za-z]/u.test(text);
	return rtl && latin ? 'mixed' : rtl ? 'clarify' : 'translate';
}

