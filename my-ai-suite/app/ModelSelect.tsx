'use client';

import { useEffect, useId, useState } from 'react';
import { PAGE_MODELS, type PageType } from './config/models';

interface ModelOption {
  id: string;
  name: string;
}

interface ModelSelectProps {
  pageType: PageType;
  onChange?: (modelId: string) => void;
}

const ModelSelect = ({ pageType, onChange }: ModelSelectProps) => {
  const id = useId();

  const models: readonly ModelOption[] = PAGE_MODELS[pageType] ?? [];
  const defaultId = models[0]?.id ?? '';

  const [selectedModel, setSelectedModel] = useState<string>(defaultId);

  const activeModel = models.some((m) => m.id === selectedModel) ? selectedModel : defaultId;

  useEffect(() => {
    if (activeModel) onChange?.(activeModel);
    // onChange is left out so an inline callback doesn't re-fire this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModel]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(e.target.value);
  };

  return (
    <div className="model-select-container">
      <label htmlFor={id} className="model-select-label">
        Active {pageType} model: 
      </label>
      <select id={id} value={activeModel} onChange={handleChange} disabled={models.length === 0} className="model-select-input input-button" >
        {models.length === 0 ? (
          <option value="">No models available</option>
        ) : (
          models.map((m) => (
            <option key={m.id} value={m.id} className="model-select-option">
              {m.name}
            </option>
          ))
        )}
      </select>
    </div>
  );
};

export default ModelSelect;