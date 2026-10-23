import { Registry } from '../core/index.ts';
import { registerPhoneCase } from '../phonecase/index.ts';
import { registerBots } from '../bots/index.ts';

/** Registers the built-in (core) extensions. Mods will register additional ones through the same registry. */
export function bootstrap(): Registry {
  const reg = new Registry();
  registerPhoneCase(reg);
  registerBots(reg);
  return reg;
}
