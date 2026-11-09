'use client';

import { useState, useEffect, useCallback } from "react";

const useToggle = (breakpoint: number) => {
    const [isOpen, setIsOpen] = useState(false);

    
    const handleToggle = useCallback(() => {
        setIsOpen((prev) => !prev);
      }, []);  

    const handleClose = useCallback(() => {
        setIsOpen(false);
    }, []);

    useEffect(() => {
        const handleResize = () => {
          if (window.innerWidth >= breakpoint) {
            setIsOpen(false);
          }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
      }, [breakpoint]);


      return { isOpen, handleToggle, handleClose };
}

export default useToggle;