// @ts-nocheck
// ================== Package Imports ==================
require("dotenv").config();
import express, { Express, Request, Response, RequestHandler } from "express";
import cors from "cors";
import Stripe from "stripe";

const { json, urlencoded } = require("body-parser");

// App init
const app: Express = express();
app.use(json());
app.use(urlencoded({ extended: true }));
app.use(cors());

// ======= Middleware =======
// M1: Init Stripe client
const addStripeClient: RequestHandler = async (req, res, next) => {
  try {
    // const stripe = new Stripe(process.env.STRIPE_TEST_KEY as string, {
    //   apiVersion: "2024-06-20; embedded_connect_beta=v2;",
    // });
    const stripe = new Stripe(process.env.STRIPE_TEST_KEY as string);
    console.log(stripe);
    // Enrich res.locals
    res.locals.stripeClient = stripe;
    // Next
    next();
  } catch (e) {
    res.json({ error: "Failed to connect to database", detail: e }).status(500);
  }
};

// ======= Functions =======
// F1: Calculate basket total
const getBasketTotal = (fruitBasket: FruitBasketItem[]) => {
  let amount = 0;
  fruitBasket.forEach((fruit) => {
    const { quantity, cost } = fruit;
    const fruitCost = quantity * cost;
    amount += fruitCost;
  });
  return amount;
};

// ======= Endpoints =======
// EP1: Sense check endpoint
app.get("/", (req: Request, res: Response) => {
  const response = { Status: "Alive 🪄" };
  res.json(response);
});

// EP2: Create paymentIntent for one-time purchase guest and return client secret
app.post(
  "/paymentIntent",
  addStripeClient,
  async (req: Request, res: Response) => {
    const {
      fruitBasket,
    }: {
      fruitBasket: FruitBasketItem[];
    } = req.body;
    if (fruitBasket) {
      try {
        const amount = getBasketTotal(fruitBasket);
        const stripeClient: Stripe = res.locals.stripeClient;
        const paymentIntent = await stripeClient.paymentIntents.create({
          amount,
          currency: "gbp",
          payment_method_types: ["pay_by_bank", "card"],
        });
        // Return client secret to the front end
        const { id, client_secret } = paymentIntent;
        res
          .json({
            clientSecret: client_secret,
            paymentIntentId: id,
          })
          .status(200);
      } catch (e) {
        res
          .json({ error: "Failed to create payment intnet", detail: e })
          .status(500);
      }
    } else {
      res.json({ error: "Mising paramaters" }).status(400);
    }
  }
);

// EP3: Validate customer exists in Stripe and return payment methods
app.post(
  "/paymentMethodCustomer",
  addStripeClient,
  async (req: Request, res: Response) => {
    const { email } = req.body;
    if (email) {
      try {
        const stripeClient: Stripe = res.locals.stripeClient;
        // We don't have the Strupe customer ID saved somewhere in a DB against the email so we have to do a search rather than a standard retrieve
        const query = `email: "${email}"`;
        const customers = await stripeClient.customers.search({
          query,
        });
        // Check if customer exists (possible for duplicates edge case?)
        if (customers.data.length === 1) {
          const { id } = customers.data[0];
          const { data: paymentMethods } =
            await stripeClient.paymentMethods.list({
              customer: id,
            });
          res.json({ customerId: id, paymentMethods }).status(200);
        } else {
          res.json({ message: "No customers found" }).status(200);
        }
      } catch (e) {
        res
          .json({ error: "Failed to retrieve payment methods", detail: e })
          .status(500);
      }
    } else {
      res.json({ error: "Mising paramaters" }).status(400);
    }
  }
);

// EP4: Add customer to the payment intent for returning customers
app.post(
  "/paymentIntentUpdateCustomer",
  addStripeClient,
  async (req: Request, res: Response) => {
    const { paymentIntentId, customerId } = req.body;
    if (paymentIntentId && customerId) {
      try {
        const stripeClient: Stripe = res.locals.stripeClient;
        const paymentIntent = await stripeClient.paymentIntents.update(
          paymentIntentId,
          {
            customer: customerId,
          }
        );
        if (paymentIntent.customer) {
          res.json({ paymentIntent }).status(200);
        } else {
          res.json({ error: "Failed to update payment intent" }).status(400);
        }
      } catch (e) {
        res
          .json({ error: "Failed to update payment intent", detail: e })
          .status(500);
      }
    } else {
      res.json({ error: "Mising paramaters" }).status(400);
    }
  }
);

// EP5: Add customer to the payment intent for returning customers
app.post(
  "/paymentIntentUpdateItems",
  addStripeClient,
  async (req: Request, res: Response) => {
    const {
      paymentIntentId,
      fruitBasket,
    }: {
      paymentIntentId: string;
      fruitBasket: FruitBasketItem[];
    } = req.body;
    if (fruitBasket) {
      if (paymentIntentId && fruitBasket) {
        try {
          const amount = getBasketTotal(fruitBasket);
          const stripeClient: Stripe = res.locals.stripeClient;
          const paymentIntent = await stripeClient.paymentIntents.update(
            paymentIntentId,
            {
              amount,
            }
          );
          if (paymentIntent.amount === amount) {
            res.json({ paymentIntent }).status(200);
          } else {
            res.json({ error: "Failed to update payment intent" }).status(400);
          }
        } catch (e) {
          res
            .json({ error: "Failed to update payment intent", detail: e })
            .status(500);
        }
      } else {
        res.json({ error: "Mising paramaters" }).status(400);
      }
    }
  }
);

// EP6: Setup future usage
app.post(
  "/paymentIntentUpdateFutureUsage",
  addStripeClient,
  async (req: Request, res: Response) => {
    const { paymentIntentId } = req.body;
    if (paymentIntentId) {
      try {
        const stripeClient: Stripe = res.locals.stripeClient;
        const paymentIntent = await stripeClient.paymentIntents.update(
          paymentIntentId,
          {
            setup_future_usage: "on_session",
          }
        );
        if (paymentIntent.customer) {
          res.json({ paymentIntent }).status(200);
        } else {
          res.json({ error: "Failed to update payment intent" }).status(400);
        }
      } catch (e) {
        res
          .json({ error: "Failed to update payment intent", detail: e })
          .status(500);
      }
    } else {
      res.json({ error: "Mising paramaters" }).status(400);
    }
  }
);

// EP7: Detach payment method
app.post(
  "/paymentMethodDetach",
  addStripeClient,
  async (req: Request, res: Response) => {
    const { paymentMethodId } = req.body;
    if (paymentMethodId) {
      try {
        const stripeClient: Stripe = res.locals.stripeClient;
        const paymentMethod = await stripeClient.paymentMethods.detach(
          paymentMethodId
        );
        if (paymentMethod.id && !paymentMethod.customer) {
          res.json({ paymentMethodId: paymentMethod.id }).status(200);
        } else {
          res.json({ error: "Failed to update payment method" }).status(400);
        }
      } catch (e) {
        res
          .json({ error: "Failed to update payment method", detail: e })
          .status(500);
      }
    } else {
      res.json({ error: "Mising paramaters" }).status(400);
    }
  }
);

// EP8: Create customer and add to existing Payment Intent
app.post(
  "/paymentIntentAddCustomer",
  addStripeClient,
  async (req: Request, res: Response) => {
    const { customerEmail, customerAddress, paymentIntentId } = req.body;
    if (customerEmail && customerAddress && paymentIntentId) {
      try {
        const stripeClient: Stripe = res.locals.stripeClient;
        const { name, address } = customerAddress;
        const customer = await stripeClient.customers.create({
          email: customerEmail,
          name,
          address,
        });
        if (customer.id) {
          const paymentIntent = await stripeClient.paymentIntents.update(
            paymentIntentId,
            {
              customer: customer.id,
            }
          );
          if (paymentIntent.id) {
            res.json({ paymentIntentId: paymentIntentId.id }).status(200);
          } else {
            res.json({ error: "Failed to update payment intent" }).status(400);
          }
        }
      } catch (e) {
        res
          .json({
            error: "Failed to add customer and update payment intent",
            detail: e,
          })
          .status(500);
      }
    } else {
      res.json({ error: "Mising paramaters" }).status(400);
    }
  }
);

app.post("/createAccountSession", addStripeClient, async (req, res) => {
  try {
    const stripeClient: Stripe = res.locals.stripeClient;
    const accountSession = await stripeClient.accountSessions.create({
      // account: "acct_1PgOx9FedHP9Jgej",
      // ACT DETAILS
      // account: "acct_1Q5UzrIXG9Ac5TuX",
      // FRESH ACT
      // account: "acct_1Q5VFqI69ZWsPNKQ",
      // account: "acct_1Q5S2JIsupeQNosj",
      // account: "acct_1Q5S2JIsupeQNosj",
      account: "acct_1QVUexImeL3n4brM",
      components: {
        account_onboarding: {
          enabled: true,
          features: {
            external_account_collection: true,
          },
        },
        payments: {
          enabled: true,
          features: {
            refund_management: true,
            dispute_management: true,
            capture_payments: true,
          },
        },
        account_management: {
          enabled: true,
          features: {
            external_account_collection: true,
          },
        },
        // payment_method_settings: {
        //   enabled: true,
        // },
        notification_banner: {
          enabled: true,
          features: {
            external_account_collection: true,
          },
        },
      },
    });

    res.json({
      client_secret: accountSession.client_secret,
    });
  } catch (error) {
    console.error(
      "An error occurred when calling the Stripe API to create an account session",
      error
    );
    res.status(500);
    res.send({ error: error.message });
  }
});

app.post("/connection_token", addStripeClient, async (req, res) => {
  console.log(req);
});

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  addStripeClient,
  (req: Request, res: Response) => {
    console.log("webhook received");
    let event;
    const sig = req.headers["stripe-signature"];
    if (sig) {
      try {
        const stripeClient: Stripe = res.locals.stripeClient;
        event = stripeClient.webhooks.constructEvent(
          req.body,
          sig,
          process.env.ENDPOINT_SECRET as string
        );
        console.log(event.data.object);
        // Handle the event
        switch (event.type) {
          case "payment_intent.succeeded":
            const paymentIntent = event.data.object;
            // Then define and call a method to handle the successful payment intent.
            // handlePaymentIntentSucceeded(paymentIntent);
            break;
          case "payment_method.attached":
            const paymentMethod = event.data.object;
            // Then define and call a method to handle the successful attachment of a PaymentMethod.
            // handlePaymentMethodAttached(paymentMethod);
            break;
          // ... handle other event types
          default:
            console.log(`Unhandled event type ${event.type}`);
        }

        // Return a response to acknowledge receipt of the event
        res.json({ received: true });
      } catch {
        res.status(500);
      }
    } else {
      res.status(500);
    }
  }
);

// ================== Server Setup ==================
const port: string = process.env.PORT || "7001";

app.listen(port, () =>
  console.log(`===== Server running on port ${port} =====`)
);

export default app;
