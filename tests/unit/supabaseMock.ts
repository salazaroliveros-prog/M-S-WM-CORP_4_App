type SupabaseResult<T = any> = { data: T | null; error: any | null };

type FromQuery = {
  table: string;
  ops: Array<{ op: string; args: any[] }>;
};

type RpcQuery = { fn: string; args: any };

type InvokeQuery = { fn: string; args: any };

type Handlers = {
  from?: (q: FromQuery) => Promise<SupabaseResult> | SupabaseResult;
  rpc?: (q: RpcQuery) => Promise<SupabaseResult> | SupabaseResult;
  invoke?: (q: InvokeQuery) => Promise<SupabaseResult> | SupabaseResult;
  getSession?: () => Promise<{ data: { session: any | null } }> | { data: { session: any | null } };
  signInAnonymously?: () =>
    | Promise<{ error: any | null; data?: { session?: any | null } }>
    | { error: any | null; data?: { session?: any | null } };
  setSession?: (args: { access_token: string; refresh_token: string }) =>
    | Promise<{ error: any | null }>
    | { error: any | null };
  getUser?: () =>
    | Promise<{ data: { user: any | null }; error: any | null }>
    | { data: { user: any | null }; error: any | null };
};

export type SupabaseMock = {
  calls: Array<any>;
  from: (table: string) => any;
  rpc: (fn: string, args: any) => Promise<SupabaseResult>;
  functions: { invoke: (fn: string, args: any) => Promise<SupabaseResult> };
  auth: {
    getSession: () => Promise<{ data: { session: any | null } }>;
    signInAnonymously: () => Promise<{ error: any | null; data?: { session?: any | null } }>;
    setSession: (args: { access_token: string; refresh_token: string }) => Promise<{ error: any | null }>;
    getUser: () => Promise<{ data: { user: any | null }; error: any | null }>;
  };
};

class QueryBuilder {
  private readonly table: string;
  private readonly calls: Array<any>;
  private readonly handlers: Handlers;
  private readonly ops: Array<{ op: string; args: any[] }> = [];

  constructor(table: string, calls: Array<any>, handlers: Handlers) {
    this.table = table;
    this.calls = calls;
    this.handlers = handlers;
    this.calls.push({ type: 'from', table });
  }

  private push(op: string, ...args: any[]) {
    this.ops.push({ op, args });
    this.calls.push({ type: 'from.op', table: this.table, op, args });
    return this;
  }

  select(...args: any[]) {
    return this.push('select', ...args);
  }
  insert(...args: any[]) {
    return this.push('insert', ...args);
  }
  update(...args: any[]) {
    return this.push('update', ...args);
  }
  upsert(...args: any[]) {
    return this.push('upsert', ...args);
  }
  delete(...args: any[]) {
    return this.push('delete', ...args);
  }
  eq(...args: any[]) {
    return this.push('eq', ...args);
  }
  in(...args: any[]) {
    return this.push('in', ...args);
  }
  order(...args: any[]) {
    return this.push('order', ...args);
  }
  limit(...args: any[]) {
    return this.push('limit', ...args);
  }
  single(...args: any[]) {
    return this.push('single', ...args);
  }
  maybeSingle(...args: any[]) {
    return this.push('maybeSingle', ...args);
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2> {
    const handler = this.handlers.from;
    const q: FromQuery = { table: this.table, ops: this.ops.slice() };
    const out = handler ? handler(q) : ({ data: null, error: null } satisfies SupabaseResult);
    return Promise.resolve(out)
      .then((res) => (onfulfilled ? onfulfilled(res) : (res as any)))
      .catch((err) => (onrejected ? onrejected(err) : Promise.reject(err)));
  }
}

export function createSupabaseMock(handlers: Handlers = {}): SupabaseMock {
  const calls: Array<any> = [];

  return {
    calls,
    from: (table: string) => new QueryBuilder(table, calls, handlers),
    rpc: async (fn: string, args: any) => {
      calls.push({ type: 'rpc', fn, args });
      const out = handlers.rpc ? handlers.rpc({ fn, args }) : ({ data: null, error: null } satisfies SupabaseResult);
      return await Promise.resolve(out);
    },
    functions: {
      invoke: async (fn: string, args: any) => {
        calls.push({ type: 'invoke', fn, args });
        const out = handlers.invoke ? handlers.invoke({ fn, args }) : ({ data: null, error: null } satisfies SupabaseResult);
        return await Promise.resolve(out);
      },
    },
    auth: {
      getSession: async () => {
        calls.push({ type: 'auth.getSession' });
        const out = handlers.getSession ? handlers.getSession() : { data: { session: null } };
        return await Promise.resolve(out);
      },
      signInAnonymously: async () => {
        calls.push({ type: 'auth.signInAnonymously' });
        const out = handlers.signInAnonymously
          ? handlers.signInAnonymously()
          : ({ error: null, data: { session: null } } satisfies { error: any | null; data?: { session?: any | null } });
        return await Promise.resolve(out);
      },
      setSession: async (args: { access_token: string; refresh_token: string }) => {
        calls.push({ type: 'auth.setSession', args });
        const out = handlers.setSession ? handlers.setSession(args) : { error: null };
        return await Promise.resolve(out);
      },
      getUser: async () => {
        calls.push({ type: 'auth.getUser' });
        const out = handlers.getUser ? handlers.getUser() : { data: { user: null }, error: null };
        return await Promise.resolve(out);
      },
    },
  };
}
