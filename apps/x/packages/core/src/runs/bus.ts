import container from "../di/container.js";
import { IBus } from "../application/lib/bus.js";

export const bus = container.resolve<IBus>('bus');