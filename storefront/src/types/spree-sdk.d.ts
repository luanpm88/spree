// Sort keys our backend adds to the Store API.
//
// lft is the nested-set column the dashboard writes when staff drag a category
// into place; the backend allows sorting by it (app/models/spree/category_decorator.rb).
// Without it the category list arrives in no particular order.
export {};

declare module "@spree/sdk" {
  interface CategorySortExtensions {
    lft: true;
  }
}
