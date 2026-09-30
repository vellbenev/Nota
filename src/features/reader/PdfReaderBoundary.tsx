import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../../components/ui';

interface Props {
	children: ReactNode;
}

interface State {
	error: Error | null;
}

export default class PdfReaderBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error('PDF reader initialization failed', error, info.componentStack);
	}

	render() {
		if (this.state.error) {
			return (
				<div className='reader-error' role='alert'>
					<p>Could not initialize the PDF reader: {this.state.error.message}</p>
					<Button onClick={() => window.location.reload()}>Reload reader</Button>
				</div>
			);
		}
		return this.props.children;
	}
}

