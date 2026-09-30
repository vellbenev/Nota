export interface SegmentOption<T extends string> {
	value: T;
	label: string;
	disabled?: boolean;
}
export interface SegmentedControlProps<T extends string> {
	label: string;
	value: T;
	options: SegmentOption<T>[];
	onChange: (value: T) => void;
	className?: string;
}

