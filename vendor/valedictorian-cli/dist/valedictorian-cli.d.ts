export interface RunValedictorianCliOptions {
    argv: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdout?: (value: string) => void;
    stderr?: (value: string) => void;
    secretsRunSpawn?: import('./valedictorian-cli.secrets-run-spawn.js').SecretsRunSpawnAdapter;
}
export declare function runValedictorianCli({ argv, cwd, env, stdout, stderr, secretsRunSpawn, }: RunValedictorianCliOptions): Promise<number>;
