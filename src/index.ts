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
    const stripe = new Stripe(process.env.STRIPE_TEST_KEY as string);
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
          // Card & BACS
          //   payment_method_configuration: "pmc_1PdYTyEcWtsOmG7WMJ9bnHKE",
          // Card Only
          //   payment_method_configuration: "pmc_1Pg1y0EcWtsOmG7W2JAn5Yys",
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

// ================== Server Setup ==================
const port: string = process.env.PORT || "3000";

app.listen(port, () =>
  console.log(`===== Server running on port ${port} =====`)
);

export default app;
