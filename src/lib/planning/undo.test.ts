import { describe, expect, it } from 'vitest';
import { combine, UndoStack, type UndoCommand } from './undo.js';

function command(log: string[], name: string, options: { failUndo?: boolean } = {}): UndoCommand {
	return {
		label: name,
		undo: async () => {
			if (options.failUndo) throw new Error('boom');
			log.push(`undo ${name}`);
		},
		redo: async () => void log.push(`redo ${name}`)
	};
}

describe('UndoStack', () => {
	it('undoes in reverse order and redoes again', async () => {
		const log: string[] = [];
		const stack = new UndoStack();
		stack.push(command(log, 'a'));
		stack.push(command(log, 'b'));
		expect(stack.undoLabel).toBe('b');
		expect(await stack.undo()).toBe('b');
		expect(await stack.undo()).toBe('a');
		expect(await stack.undo()).toBeNull();
		expect(await stack.redo()).toBe('a');
		expect(log).toEqual(['undo b', 'undo a', 'redo a']);
		expect(stack.canRedo).toBe(true);
	});
	it('drops the redo branch on a new command', async () => {
		const log: string[] = [];
		const stack = new UndoStack();
		stack.push(command(log, 'a'));
		await stack.undo();
		stack.push(command(log, 'c'));
		expect(stack.canRedo).toBe(false);
	});
	it('keeps the command when undo fails so the user can retry', async () => {
		const stack = new UndoStack();
		stack.push(command([], 'a', { failUndo: true }));
		await expect(stack.undo()).rejects.toThrow('boom');
		expect(stack.canUndo).toBe(true);
		expect(stack.canRedo).toBe(false);
	});
	it('caps the history', () => {
		const stack = new UndoStack(2);
		for (const n of ['a', 'b', 'c']) stack.push(command([], n));
		expect(stack.undoLabel).toBe('c');
		stack.clear();
		expect(stack.canUndo).toBe(false);
	});
	it('ignores a second undo while one is running', async () => {
		const stack = new UndoStack();
		let release!: () => void;
		stack.push({ label: 'slow', undo: () => new Promise<void>((r) => (release = r)), redo: async () => {} });
		const first = stack.undo();
		expect(await stack.undo()).toBeNull();
		release();
		expect(await first).toBe('slow');
	});

	it('combines commands: undo in reverse order, redo in order', async () => {
		const log: string[] = [];
		const both = combine('both', [command(log, 'a'), command(log, 'b')]);
		await both.undo();
		await both.redo();
		expect(log).toEqual(['undo b', 'undo a', 'redo a', 'redo b']);
	});
});
