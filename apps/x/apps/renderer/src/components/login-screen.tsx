import { Button } from './ui/button';
import { LoaderIcon } from 'lucide-react';

interface LoginScreenProps {
  isLoggingIn: boolean;
  error: string | null;
  login: () => Promise<void>;
}

export function LoginScreen({ isLoggingIn, error, login }: LoginScreenProps) {
  return (
    <div className="flex h-svh w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 max-w-sm text-center px-4">
        <div className="text-4xl font-semibold tracking-tight text-foreground/80">
          Rowboat
        </div>
        <p className="text-sm text-muted-foreground">
          Sign in to your Rowboat account to continue.
        </p>

        {error && (
          <div className="w-full rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button
          onClick={login}
          disabled={isLoggingIn}
          className="w-full"
          size="lg"
        >
          {isLoggingIn ? (
            <>
              <LoaderIcon className="h-4 w-4 animate-spin mr-2" />
              Waiting for browser...
            </>
          ) : (
            'Sign in to Rowboat'
          )}
        </Button>

        {isLoggingIn && (
          <p className="text-xs text-muted-foreground">
            Complete sign-in in your browser, then return here.
          </p>
        )}
      </div>
    </div>
  );
}
