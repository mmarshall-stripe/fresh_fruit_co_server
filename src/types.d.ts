interface FruitItem {
  label: FruitLabel;
  ref: FruitRef;
  cost: number;
}

interface FruitBasketItem extends FruitItem {
  quantity: number;
}

type FruitRef = "strawberries" | "oranges" | "grapes" | "apples";

type FruitLabel = "🍓 Strawberries" | "🍊 Oranges" | "🍇 Grapes" | "🍎 Apples";
