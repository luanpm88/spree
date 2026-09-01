import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/us/en",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next/headers
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: () => new Map(),
}));

// Mock next/cache
//
// `cacheLife()` throws unless Next is running with `cacheComponents`, which is
// set in next.config.ts and which vitest does not load. So any test that
// reaches a "use cache" data function, however indirectly, fails with a config
// error that has nothing to do with what it was testing: adding getPolicies()
// to the footer broke six sitemap tests and a layout test, none of which
// mention policies.
//
// Here rather than in each test for the same reason the four mocks around it
// are here. A test file cannot be expected to know which of its transitive
// imports happens to be cached today. Files that assert on these calls mock
// them again locally, which still takes precedence.
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

// Mock next/image → plain <img>
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const {
      fill,
      priority,
      fetchPriority,
      blurDataURL,
      placeholder,
      unoptimized,
      ...rest
    } = props;
    // biome-ignore lint/performance/noImgElement: test mock for next/image
    // biome-ignore lint/a11y/useAltText: test mock passes through all props including alt
    return <img {...rest} />;
  },
}));

// Mock next/link → plain <a>
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
