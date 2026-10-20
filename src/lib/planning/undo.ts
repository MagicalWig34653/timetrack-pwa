/** One reversible change. `undo` and `redo` talk to the server; they reject when the change cannot be applied any more. */
export interface UndoCommand {
	label: string;
	undo: () => Promise<void>;
	redo: () => Promise<void>;
}

/**
 * Linear undo/redo history. A new command clears the redo branch. Failing undo/redo keeps the command where it
 * was and rethrows, so the caller can show the error and the user can retry.
 */
export class UndoStack {
	#past: UndoCommand[] = [];
	#future: UndoCommand[] = [];
	#busy = false;

	constructor(private readonly limit = 50) {}

	push(command: UndoCommand): void {
		this.#past.push(command);
		if (this.#past.length > this.limit) this.#past.shift();
		this.#future = [];
	}

	get canUndo() {
		return this.#past.length > 0;
	}
	get canRedo() {
		return this.#future.length > 0;
	}
	get undoLabel() {
		return this.#past[this.#past.length - 1]?.label ?? null;
	}
	get redoLabel() {
		return this.#future[this.#future.length - 1]?.label ?? null;
	}

	/** Returns the undone command's label, or null when nothing was done (empty or busy). */
	async undo(): Promise<string | null> {
		const command = this.#past[this.#past.length - 1];
		if (!command || this.#busy) return null;
		this.#busy = true;
		try {
			await command.undo();
			this.#past.pop();
			this.#future.push(command);
			return command.label;
		} finally {
			this.#busy = false;
		}
	}

	async redo(): Promise<string | null> {
		const command = this.#future[this.#future.length - 1];
		if (!command || this.#busy) return null;
		this.#busy = true;
		try {
			await command.redo();
			this.#future.pop();
			this.#past.push(command);
			return command.label;
		} finally {
			this.#busy = false;
		}
	}

	clear(): void {
		this.#past = [];
		this.#future = [];
	}
}

/** Several writes that belong to one user action (e.g. one absence per run of a multi-selection) undo together, in reverse. */
export function combine(label: string, commands: UndoCommand[]): UndoCommand {
	return {
		label,
		undo: async () => {
			for (const c of [...commands].reverse()) await c.undo();
		},
		redo: async () => {
			for (const c of commands) await c.redo();
		}
	};
}
