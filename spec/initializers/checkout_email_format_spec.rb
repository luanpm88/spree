# frozen_string_literal: true

# config/initializers/checkout_email_format.rb: the cart lists a malformed email as
# an address requirement, so the storefront stops at Pay now instead of taking the
# money and failing at complete (docs/DISCOVERIES.md §88).
RSpec.describe 'checkout email format requirement' do
  let(:store) { @default_store }

  # Only what a real cart has at the address step: an email the customer typed.
  # Nothing here registers the requirement; it must already be there from boot.
  def email_requirements(email)
    order = create(:order, store: store, user: nil, email: email, state: 'address')
    Spree::Checkout::Requirements.new(order).call.select { |r| r[:field] == 'email' }
  end

  it 'is registered at boot, once' do
    fields = Spree::Checkout::Registry.requirements.map { |r| [r.step, r.field] }
    expect(fields.count(%w[address email])).to eq(1)
  end

  it 'lists an email without @ at the address step, which the storefront checks before payment' do
    expect(email_requirements('name.example.com'))
      .to contain_exactly(step: 'address', field: 'email', message: 'Please enter a valid email address')
  end

  it 'passes a well formed email' do
    expect(email_requirements('name@example.com')).to be_empty
  end

  it "leaves a blank email to Spree's own requirement, so it is not reported twice" do
    expect(email_requirements(nil).map { |r| r[:message] })
      .to eq([Spree.t('checkout_requirements.email_required')])
  end

  # The requirement and the validator that runs at complete must agree, or a
  # customer is either stopped for nothing or charged and then refused.
  it 'agrees with the validator that runs at complete on every case' do
    ['a@b.co', 'name.example.com', 'name@example', 'name@@example.com', 'first.last+tag@sub.example.co.nz',
     'name@example.com ', ' name@example.com', 'name@exa mple.com'].each do |email|
      listed = email_requirements(email).any?
      complete_refuses = !EmailValidator::EMAIL_REGEX.match?(email)
      expect(listed).to eq(complete_refuses), "#{email.inspect}: listed #{listed}, refused at complete #{complete_refuses}"
    end
  end
end
