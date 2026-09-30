import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import styles from './Field.module.css';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
	{ className = '', ...props },
	ref,
) {
	return <input {...props} ref={ref} className={`${styles.field} ${className}`} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
	{ className = '', ...props },
	ref,
) {
	return <textarea {...props} ref={ref} className={`${styles.field} ${styles.textarea} ${className}`} />;
});
