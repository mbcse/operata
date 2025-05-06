import { Queue, Worker, Job, JobsOptions, WorkerOptions } from 'bullmq';
import {v4 as uuid} from "uuid";
import { Logger } from '@/common/utils/logger';

interface QueueConfig {
    host: string;
    port?: number;
    password?: string;
    db?: number;
    defaultJobOptions?: {
        attempts?: number;
        backoff?: {
            type: 'fixed' | 'exponential';
            delay: number;
        };
    };
}

interface JobData {
    [key: string]: any;
}

class QueueManager {
    private queue: Queue;
    private queueName: string;
    private worker: Worker | null = null;

    constructor(queueName: string, config: QueueConfig) {
        this.queueName = queueName;
        const connection = {
            host: config.host,
            port: config.port,
            password: config.password,
            db: config.db,
            retryStrategy: (times: number) => {
                const delay = Math.min(times * 50, 2000);
                Logger.info('QueueManager', `Retrying Redis connection`, { queueName, times, delay });
                return delay;
            }
        };

        this.queue = new Queue(queueName, {
            connection,
            defaultJobOptions: config.defaultJobOptions
        });

        // Add connection event listeners
        this.queue.on('error', (error: Error) => {
            Logger.error('QueueManager', `Queue error`, { queueName, error });
        });

        Logger.info('QueueManager', `Initialized queue`, { queueName, host: config.host, port: config.port });
    }

    /**
     * Add a job to the queue
     * @param data - The data to be processed
     * @param options - Optional job options
     * @returns Promise<Job>
     */
    async addToQueue(data: JobData, options?: JobsOptions): Promise<Job> {
        try {
            const jobId = uuid();
            Logger.info('QueueManager', `Adding job to queue`, { queueName: this.queueName, jobId, data });
            return await this.queue.add(jobId, data, options);
        } catch (error) {
            Logger.error('QueueManager', `Error adding job to queue`, { queueName: this.queueName, error });
            throw error;
        }
    }

    /**
     * Register a worker to process jobs
     * @param processor - The function to process jobs
     * @param options - Optional worker options
     */
    async registerWorker(processor: (job: Job) => Promise<any>, options?: any): Promise<void> {
        Logger.info('QueueManager', `Registering worker for queue`, { queueName: this.queueName, options });
        try {
            const connection = this.queue.opts.connection;
            this.worker = new Worker(this.queueName, processor, {
                connection,
                ...options,
                lockDuration: 30000, // Lock duration in milliseconds
                stalledInterval: 30000, // Check for stalled jobs every 30 seconds
            });

            this.worker.on('completed', (job: Job) => {
                Logger.info('QueueManager', `Job completed successfully`, { queueName: this.queueName, jobId: job.id });
            });

            this.worker.on('failed', (job: Job | undefined, error: Error) => {
                Logger.error('QueueManager', `Job failed`, { queueName: this.queueName, jobId: job?.id, error });
            });

            this.worker.on('error', (error: Error) => {
                Logger.error('QueueManager', `Worker error`, { queueName: this.queueName, error });
            });

            this.worker.on('stalled', (jobId: string) => {
                Logger.warn('QueueManager', `Job stalled`, { queueName: this.queueName, jobId });
            });

            this.worker.on('active', (job: Job) => {
                Logger.info('QueueManager', `Job started`, { queueName: this.queueName, jobId: job.id });
            });

            Logger.info('QueueManager', `Worker registered successfully`, { queueName: this.queueName });
        } catch (error) {
            Logger.error('QueueManager', `Error registering worker`, { queueName: this.queueName, error });
            throw error;
        }
    }

    /**
     * Pause the queue
     */
    async pauseQueue(): Promise<void> {
        try {
            await this.queue.pause();
            Logger.info('QueueManager', `Queue paused`, { queueName: this.queueName });
        } catch (error) {
            Logger.error('QueueManager', `Error pausing queue`, { queueName: this.queueName, error });
            throw error;
        }
    }

    /**
     * Resume the queue
     */
    async resumeQueue(): Promise<void> {
        try {
            await this.queue.resume();
            Logger.info('QueueManager', `Queue resumed`, { queueName: this.queueName });
        } catch (error) {
            Logger.error('QueueManager', `Error resuming queue`, { queueName: this.queueName, error });
            throw error;
        }
    }

    /**
     * Get queue status
     */
    async getQueueStatus(): Promise<{
        waiting: number;
        active: number;
        completed: number;
        failed: number;
    }> {
        try {
            const [waiting, active, completed, failed] = await Promise.all([
                this.queue.getWaitingCount(),
                this.queue.getActiveCount(),
                this.queue.getCompletedCount(),
                this.queue.getFailedCount(),
            ]);

            Logger.info('QueueManager', `Queue status`, { 
                queueName: this.queueName,
                waiting,
                active,
                completed,
                failed
            });

            return { waiting, active, completed, failed };
        } catch (error) {
            Logger.error('QueueManager', `Error getting queue status`, { queueName: this.queueName, error });
            throw error;
        }
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        try {
            if (this.worker) {
                await this.worker.close();
            }
            await this.queue.close();
            Logger.info('QueueManager', `Queue and worker cleaned up`, { queueName: this.queueName });
        } catch (error) {
            Logger.error('QueueManager', `Error during cleanup`, { queueName: this.queueName, error });
            throw error;
        }
    }
}

export default QueueManager;