import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly publisher: Redis;
  readonly subscriber: Redis;
  private readonly connectionPromises = new WeakMap<Redis, Promise<void>>();

  constructor() {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    this.publisher = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.subscriber = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  private ensureConnected(client: Redis): Promise<void> {
    if (client.status !== "wait") return Promise.resolve();

    const existing = this.connectionPromises.get(client);
    if (existing) return existing;

    const connecting = client
      .connect()
      .finally(() => this.connectionPromises.delete(client));
    this.connectionPromises.set(client, connecting);
    return connecting;
  }

  async ping(): Promise<string> {
    await this.ensureConnected(this.publisher);
    return this.publisher.ping();
  }

  async publish(channel: string, payload: unknown): Promise<number> {
    await this.ensureConnected(this.publisher);
    return this.publisher.publish(channel, JSON.stringify(payload));
  }

  async subscribe(
    channels: string[],
    handler: (channel: string, payload: string) => void,
  ): Promise<void> {
    await this.ensureConnected(this.subscriber);
    await this.subscriber.subscribe(...channels);
    this.subscriber.on("message", handler);
  }

  onModuleDestroy(): void {
    if (this.publisher.status !== "end") this.publisher.disconnect();
    if (this.subscriber.status !== "end") this.subscriber.disconnect();
  }
}
